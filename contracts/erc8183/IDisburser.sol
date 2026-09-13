// SPDX-License-Identifier: MIT
// ERC-8183: Agentic Commerce — optional payout receiver callback.
pragma solidity ^0.8.28;

/**
 * @title IDisburser
 * @dev Optional interface a job's `payoutReceiver` contract can implement to
 *      be notified when a JobEscrow releases funds to it — e.g. a splitter
 *      contract that forwards shares to sub-agents that helped complete the
 *      job. The escrow calls this best-effort (via try/catch): a revert here
 *      does not roll back the underlying token transfer.
 */
interface IDisburser {
    function onDisbursement(uint256 jobId, address token, uint256 amount) external;
}
