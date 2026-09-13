// SPDX-License-Identifier: MIT
// ERC-8004: Trustless Agents — Validation Registry
// Lets an agent owner request an off-chain (e.g. TEE attestation) or
// on-chain validation of their agent's work from a chosen validator, and
// lets that validator publish a result back on-chain. This part of the
// ERC-8004 spec is still evolving upstream, so this is a minimal, working
// version of the request/response hooks rather than a byte-for-byte port.
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./IdentityRegistry.sol";

contract ValidationRegistry is OwnableUpgradeable, UUPSUpgradeable {
    enum ValidationStatus {
        None,
        Requested,
        Responded
    }

    struct ValidationRequest {
        uint256 agentId;
        address validator;
        address requester;
        string requestURI;
        bytes32 requestHash;
        ValidationStatus status;
        uint8 response;
        string responseURI;
        bytes32 responseHash;
        bytes32 tag;
    }

    IdentityRegistry public identityRegistry;

    uint256 private _nonce;
    mapping(bytes32 => ValidationRequest) private _requests;
    mapping(uint256 => bytes32[]) private _agentRequestIds;
    mapping(address => bytes32[]) private _validatorRequestIds;

    event ValidationRequested(
        bytes32 indexed requestId,
        uint256 indexed agentId,
        address indexed validator,
        address requester,
        string requestURI,
        bytes32 requestHash
    );
    event ValidationResponded(
        bytes32 indexed requestId,
        uint8 response,
        string responseURI,
        bytes32 responseHash,
        bytes32 indexed tag
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner, address identityRegistry_) public initializer {
        __Ownable_init(initialOwner);
        require(identityRegistry_ != address(0), "bad identity registry");
        identityRegistry = IdentityRegistry(identityRegistry_);
    }

    function validationRequest(
        address validatorAddress,
        uint256 agentId,
        string calldata requestURI,
        bytes32 requestHash
    ) external returns (bytes32 requestId) {
        require(validatorAddress != address(0), "bad validator");
        require(identityRegistry.isAuthorizedOrOwner(msg.sender, agentId), "not authorized");

        requestId = keccak256(abi.encodePacked(agentId, validatorAddress, requestHash, block.timestamp, _nonce++));
        _requests[requestId] = ValidationRequest({
            agentId: agentId,
            validator: validatorAddress,
            requester: msg.sender,
            requestURI: requestURI,
            requestHash: requestHash,
            status: ValidationStatus.Requested,
            response: 0,
            responseURI: "",
            responseHash: bytes32(0),
            tag: bytes32(0)
        });
        _agentRequestIds[agentId].push(requestId);
        _validatorRequestIds[validatorAddress].push(requestId);

        emit ValidationRequested(requestId, agentId, validatorAddress, msg.sender, requestURI, requestHash);
    }

    function validationResponse(
        bytes32 requestId,
        uint8 response,
        string calldata responseURI,
        bytes32 responseHash,
        bytes32 tag
    ) external {
        ValidationRequest storage req = _requests[requestId];
        require(req.status == ValidationStatus.Requested, "not pending");
        require(msg.sender == req.validator, "only validator");

        req.status = ValidationStatus.Responded;
        req.response = response;
        req.responseURI = responseURI;
        req.responseHash = responseHash;
        req.tag = tag;

        emit ValidationResponded(requestId, response, responseURI, responseHash, tag);
    }

    function getValidationStatus(bytes32 requestId) external view returns (ValidationStatus) {
        return _requests[requestId].status;
    }

    function getValidationRequest(bytes32 requestId) external view returns (ValidationRequest memory) {
        return _requests[requestId];
    }

    function getAgentValidations(uint256 agentId) external view returns (bytes32[] memory) {
        return _agentRequestIds[agentId];
    }

    function getValidatorRequests(address validatorAddress) external view returns (bytes32[] memory) {
        return _validatorRequestIds[validatorAddress];
    }

    function getVersion() external pure returns (string memory) {
        return "1.0.0";
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
