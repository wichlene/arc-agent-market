// SPDX-License-Identifier: MIT
// ERC-8183: Agentic Commerce — Job Escrow
// A Job holds a Client-funded budget in an allowlisted ERC-20 (on Arc:
// native USDC) until a Provider delivers and an Evaluator attests the work,
// at which point escrow releases to the Provider (or a delegated
// IDisburser). State machine: Open -> Funded -> Submitted -> Completed |
// Rejected | Expired. Optional per-job IERC8183Hook lets integrators gate
// or react to any transition without touching this contract.
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./IERC8183Hook.sol";
import "./IDisburser.sol";

contract JobEscrow is
    OwnableUpgradeable,
    UUPSUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardTransient
{
    using SafeERC20 for IERC20;

    enum JobStatus {
        Open,
        Funded,
        Submitted,
        Completed,
        Rejected,
        Expired
    }

    struct Job {
        address client;
        address provider;
        address evaluator;
        address paymentToken;
        address hook;
        address payoutReceiver;
        uint256 budget;
        uint256 settledAmount;
        uint256 providerAgentId;
        uint48 createdAt;
        uint48 expiresAt;
        uint48 submittedAt;
        JobStatus status;
        string description;
        string deliverableURI;
        bytes32 deliverableHash;
    }

    /// @dev Grace period after `expiresAt` during which only the evaluator
    /// may still complete/reject a Submitted job before anyone can force a
    /// refund to the client.
    uint256 public constant EVALUATOR_GRACE_PERIOD = 1 hours;

    /// @dev Fee cap: platform fee can never exceed 10% of a job's budget.
    uint16 public constant MAX_PLATFORM_FEE_BPS = 1_000;

    uint256 private _nextJobId;
    mapping(uint256 => Job) public jobs;
    mapping(address => bool) public allowedPaymentTokens;

    uint16 public platformFeeBps;
    address public feeRecipient;

    event PaymentTokenAllowed(address indexed token, bool allowed);
    event PlatformFeeUpdated(uint16 feeBps, address indexed recipient);

    event JobCreated(
        uint256 indexed jobId,
        address indexed client,
        address indexed provider,
        address evaluator,
        address paymentToken,
        uint256 budget,
        uint256 expiresAt,
        uint256 providerAgentId
    );
    event JobFunded(uint256 indexed jobId, uint256 budget);
    event JobSubmitted(uint256 indexed jobId, string deliverableURI, bytes32 deliverableHash);
    event JobCompleted(uint256 indexed jobId, address indexed payoutReceiver, uint256 payout, uint256 platformFee);
    event JobRejected(uint256 indexed jobId, string reason);
    event JobExpired(uint256 indexed jobId, address refundedTo, uint256 amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner, address initialFeeRecipient) public initializer {
        __Ownable_init(initialOwner);
        __Pausable_init();
        feeRecipient = initialFeeRecipient;
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setAllowedPaymentToken(address token, bool allowed) external onlyOwner {
        require(token != address(0), "bad token");
        allowedPaymentTokens[token] = allowed;
        emit PaymentTokenAllowed(token, allowed);
    }

    function setPlatformFee(uint16 feeBps, address recipient) external onlyOwner {
        require(feeBps <= MAX_PLATFORM_FEE_BPS, "fee too high");
        require(feeBps == 0 || recipient != address(0), "bad recipient");
        platformFeeBps = feeBps;
        feeRecipient = recipient;
        emit PlatformFeeUpdated(feeBps, recipient);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ---------------------------------------------------------------------
    // Job lifecycle
    // ---------------------------------------------------------------------

    function createJob(
        address provider,
        address evaluator,
        address paymentToken,
        uint256 budget,
        uint256 durationSeconds,
        string calldata description,
        uint256 providerAgentId,
        address hook
    ) external whenNotPaused returns (uint256 jobId) {
        require(provider != address(0) && evaluator != address(0), "bad parties");
        require(allowedPaymentTokens[paymentToken], "token not allowed");
        require(budget > 0, "bad budget");
        require(durationSeconds > 0, "bad duration");

        jobId = _nextJobId++;
        uint48 expiresAt = uint48(block.timestamp + durationSeconds);

        jobs[jobId] = Job({
            client: msg.sender,
            provider: provider,
            evaluator: evaluator,
            paymentToken: paymentToken,
            hook: hook,
            payoutReceiver: address(0),
            budget: budget,
            settledAmount: 0,
            providerAgentId: providerAgentId,
            createdAt: uint48(block.timestamp),
            expiresAt: expiresAt,
            submittedAt: 0,
            status: JobStatus.Open,
            description: description,
            deliverableURI: "",
            deliverableHash: bytes32(0)
        });

        emit JobCreated(jobId, msg.sender, provider, evaluator, paymentToken, budget, expiresAt, providerAgentId);
    }

    function fund(uint256 jobId) external whenNotPaused nonReentrant {
        Job storage job = jobs[jobId];
        require(job.status == JobStatus.Open, "not open");
        require(msg.sender == job.client, "only client");

        _beforeHook(jobId, job.hook, this.fund.selector, abi.encode(jobId));

        IERC20 token = IERC20(job.paymentToken);
        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), job.budget);
        uint256 received = token.balanceOf(address(this)) - balanceBefore;
        require(received == job.budget, "fee-on-transfer token unsupported");

        job.status = JobStatus.Funded;
        emit JobFunded(jobId, job.budget);

        _afterHook(jobId, job.hook, this.fund.selector, abi.encode(jobId));
    }

    function submit(uint256 jobId, string calldata deliverableURI, bytes32 deliverableHash) external whenNotPaused {
        Job storage job = jobs[jobId];
        require(job.status == JobStatus.Funded, "not funded");
        require(msg.sender == job.provider, "only provider");
        require(block.timestamp <= job.expiresAt, "job expired");

        _beforeHook(jobId, job.hook, this.submit.selector, abi.encode(jobId, deliverableURI, deliverableHash));

        job.deliverableURI = deliverableURI;
        job.deliverableHash = deliverableHash;
        job.submittedAt = uint48(block.timestamp);
        job.status = JobStatus.Submitted;

        emit JobSubmitted(jobId, deliverableURI, deliverableHash);

        _afterHook(jobId, job.hook, this.submit.selector, abi.encode(jobId, deliverableURI, deliverableHash));
    }

    function complete(uint256 jobId, address payoutReceiver) external whenNotPaused nonReentrant {
        Job storage job = jobs[jobId];
        require(job.status == JobStatus.Submitted, "not submitted");
        require(msg.sender == job.evaluator, "only evaluator");

        _beforeHook(jobId, job.hook, this.complete.selector, abi.encode(jobId, payoutReceiver));

        address receiver = payoutReceiver == address(0) ? job.provider : payoutReceiver;
        uint256 platformFee = (job.budget * platformFeeBps) / 10_000;
        uint256 payout = job.budget - platformFee;

        job.status = JobStatus.Completed;
        job.payoutReceiver = receiver;
        job.settledAmount = payout;

        IERC20 token = IERC20(job.paymentToken);
        if (platformFee > 0 && feeRecipient != address(0)) {
            token.safeTransfer(feeRecipient, platformFee);
        }
        token.safeTransfer(receiver, payout);

        if (receiver.code.length > 0) {
            try IDisburser(receiver).onDisbursement(jobId, job.paymentToken, payout) {} catch {}
        }

        emit JobCompleted(jobId, receiver, payout, platformFee);

        _afterHook(jobId, job.hook, this.complete.selector, abi.encode(jobId, payoutReceiver));
    }

    function reject(uint256 jobId, string calldata reason) external whenNotPaused nonReentrant {
        Job storage job = jobs[jobId];
        require(job.status == JobStatus.Submitted, "not submitted");
        require(msg.sender == job.evaluator, "only evaluator");

        _beforeHook(jobId, job.hook, this.reject.selector, abi.encode(jobId, reason));

        job.status = JobStatus.Rejected;
        IERC20(job.paymentToken).safeTransfer(job.client, job.budget);

        emit JobRejected(jobId, reason);

        _afterHook(jobId, job.hook, this.reject.selector, abi.encode(jobId, reason));
    }

    /// @notice Client cancels a job that was never funded.
    function cancelOpenJob(uint256 jobId) external {
        Job storage job = jobs[jobId];
        require(job.status == JobStatus.Open, "not open");
        require(msg.sender == job.client, "only client");
        job.status = JobStatus.Expired;
        emit JobExpired(jobId, address(0), 0);
    }

    /// @notice Client reclaims escrow if the provider never submitted before the deadline.
    function reclaimExpired(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        require(job.status == JobStatus.Funded, "not funded");
        require(block.timestamp > job.expiresAt, "not expired yet");
        require(msg.sender == job.client, "only client");

        job.status = JobStatus.Expired;
        IERC20(job.paymentToken).safeTransfer(job.client, job.budget);
        emit JobExpired(jobId, job.client, job.budget);
    }

    /// @notice If a job was submitted but the evaluator never acts, either party
    /// can force a refund to the client once the deadline plus grace period has passed.
    function forceRefund(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        require(job.status == JobStatus.Submitted, "not submitted");
        require(msg.sender == job.client || msg.sender == job.provider, "not a party");
        require(block.timestamp > uint256(job.expiresAt) + EVALUATOR_GRACE_PERIOD, "grace period active");

        job.status = JobStatus.Expired;
        IERC20(job.paymentToken).safeTransfer(job.client, job.budget);
        emit JobExpired(jobId, job.client, job.budget);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getJob(uint256 jobId) external view returns (Job memory) {
        return jobs[jobId];
    }

    function nextJobId() external view returns (uint256) {
        return _nextJobId;
    }

    function getVersion() external pure returns (string memory) {
        return "1.0.0";
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _beforeHook(uint256 jobId, address hook, bytes4 selector, bytes memory data) private {
        if (hook == address(0)) return;
        IERC8183Hook(hook).beforeAction(jobId, selector, data);
    }

    function _afterHook(uint256 jobId, address hook, bytes4 selector, bytes memory data) private {
        if (hook == address(0)) return;
        IERC8183Hook(hook).afterAction(jobId, selector, data);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
