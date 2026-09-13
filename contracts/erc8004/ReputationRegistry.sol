// SPDX-License-Identifier: MIT
// ERC-8004: Trustless Agents — Reputation Registry
// Standardized feedback collection so any client can leave a signed,
// fixed-point rating for an agent registered in the IdentityRegistry, and
// anyone can read it back or aggregate it into a summary score.
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./IdentityRegistry.sol";

contract ReputationRegistry is OwnableUpgradeable, UUPSUpgradeable {
    struct Feedback {
        int256 value;
        uint8 valueDecimals;
        bytes32 tag1;
        bytes32 tag2;
        string feedbackURI;
        bytes32 feedbackHash;
        bool revoked;
        bool hasResponse;
        string responseURI;
        bytes32 responseHash;
    }

    IdentityRegistry public identityRegistry;

    // agentId => client => list of feedback the client gave that agent
    mapping(uint256 => mapping(address => Feedback[])) private _feedback;

    event FeedbackGiven(
        uint256 indexed agentId,
        address indexed client,
        uint256 index,
        int256 value,
        uint8 valueDecimals,
        bytes32 indexed tag1,
        bytes32 tag2,
        string feedbackURI,
        bytes32 feedbackHash
    );
    event FeedbackRevoked(uint256 indexed agentId, address indexed client, uint256 index);
    event ResponseAppended(uint256 indexed agentId, address indexed client, uint256 index, string responseURI, bytes32 responseHash);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner, address identityRegistry_) public initializer {
        __Ownable_init(initialOwner);
        require(identityRegistry_ != address(0), "bad identity registry");
        identityRegistry = IdentityRegistry(identityRegistry_);
    }

    function giveFeedback(
        uint256 agentId,
        int256 value,
        uint8 valueDecimals,
        bytes32 tag1,
        bytes32 tag2,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external returns (uint256 index) {
        address agentOwner = identityRegistry.ownerOf(agentId);
        require(msg.sender != agentOwner, "no self-feedback");
        require(msg.sender != identityRegistry.getAgentWallet(agentId), "no self-feedback");

        Feedback[] storage entries = _feedback[agentId][msg.sender];
        index = entries.length;
        entries.push(
            Feedback({
                value: value,
                valueDecimals: valueDecimals,
                tag1: tag1,
                tag2: tag2,
                feedbackURI: feedbackURI,
                feedbackHash: feedbackHash,
                revoked: false,
                hasResponse: false,
                responseURI: "",
                responseHash: bytes32(0)
            })
        );

        emit FeedbackGiven(agentId, msg.sender, index, value, valueDecimals, tag1, tag2, feedbackURI, feedbackHash);
    }

    function revokeFeedback(uint256 agentId, uint256 index) external {
        Feedback storage entry = _requireEntry(agentId, msg.sender, index);
        require(!entry.revoked, "already revoked");
        entry.revoked = true;
        emit FeedbackRevoked(agentId, msg.sender, index);
    }

    function appendResponse(
        uint256 agentId,
        address client,
        uint256 index,
        string calldata responseURI,
        bytes32 responseHash
    ) external {
        address agentOwner = identityRegistry.ownerOf(agentId);
        require(msg.sender == agentOwner, "only agent owner");
        Feedback storage entry = _requireEntry(agentId, client, index);
        entry.hasResponse = true;
        entry.responseURI = responseURI;
        entry.responseHash = responseHash;
        emit ResponseAppended(agentId, client, index, responseURI, responseHash);
    }

    function readFeedback(uint256 agentId, address client, uint256 index) external view returns (Feedback memory) {
        return _requireEntry(agentId, client, index);
    }

    function feedbackCount(uint256 agentId, address client) external view returns (uint256) {
        return _feedback[agentId][client].length;
    }

    function readAllFeedback(
        uint256 agentId,
        address[] calldata clients,
        bytes32 tag1,
        bytes32 tag2,
        bool includeRevoked
    ) external view returns (Feedback[] memory matches) {
        uint256 total;
        for (uint256 i; i < clients.length; i++) {
            total += _feedback[agentId][clients[i]].length;
        }

        Feedback[] memory buffer = new Feedback[](total);
        uint256 n;
        for (uint256 i; i < clients.length; i++) {
            Feedback[] storage entries = _feedback[agentId][clients[i]];
            for (uint256 j; j < entries.length; j++) {
                if (!_matches(entries[j], tag1, tag2, includeRevoked)) continue;
                buffer[n++] = entries[j];
            }
        }

        matches = new Feedback[](n);
        for (uint256 i; i < n; i++) {
            matches[i] = buffer[i];
        }
    }

    /// @dev Aggregates matching feedback into a single average, normalized to 18 decimals.
    function getSummary(
        uint256 agentId,
        address[] calldata clients,
        bytes32 tag1,
        bytes32 tag2
    ) external view returns (uint256 count, int256 averageValue, uint8 averageValueDecimals) {
        int256 sum;
        for (uint256 i; i < clients.length; i++) {
            Feedback[] storage entries = _feedback[agentId][clients[i]];
            for (uint256 j; j < entries.length; j++) {
                if (!_matches(entries[j], tag1, tag2, false)) continue;
                sum += _scaleTo18(entries[j].value, entries[j].valueDecimals);
                count++;
            }
        }
        averageValueDecimals = 18;
        averageValue = count == 0 ? int256(0) : sum / int256(count);
    }

    function _matches(Feedback storage entry, bytes32 tag1, bytes32 tag2, bool includeRevoked) private view returns (bool) {
        if (entry.revoked && !includeRevoked) return false;
        if (tag1 != bytes32(0) && entry.tag1 != tag1) return false;
        if (tag2 != bytes32(0) && entry.tag2 != tag2) return false;
        return true;
    }

    function _scaleTo18(int256 value, uint8 fromDecimals) private pure returns (int256) {
        if (fromDecimals == 18) return value;
        if (fromDecimals < 18) return value * int256(10 ** (18 - fromDecimals));
        return value / int256(10 ** (fromDecimals - 18));
    }

    function _requireEntry(uint256 agentId, address client, uint256 index) private view returns (Feedback storage) {
        Feedback[] storage entries = _feedback[agentId][client];
        require(index < entries.length, "no such feedback");
        return entries[index];
    }

    function getVersion() external pure returns (string memory) {
        return "1.0.0";
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
