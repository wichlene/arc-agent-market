// SPDX-License-Identifier: MIT
// ERC-8183: Agentic Commerce — optional extensibility hook.
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/**
 * @title IERC8183Hook
 * @dev Interface for ERC-8183 hook contracts. Implementations receive before/after
 *      callbacks on core job functions.
 *
 *      The `selector` identifies which core function is being called (e.g.
 *      JobEscrow.fund.selector). The `data` parameter contains
 *      function-specific parameters encoded as bytes.
 *
 *      This interface is intentionally minimal (two functions) so that it remains
 *      stable as the core protocol evolves — new hookable functions simply produce
 *      new selector values without changing this interface.
 */
interface IERC8183Hook is IERC165 {
    /// @dev Called before the core function executes. MAY revert to block the action.
    function beforeAction(uint256 jobId, bytes4 selector, bytes calldata data) external;

    /// @dev Called after the core function completes. MAY revert to roll back the transaction.
    function afterAction(uint256 jobId, bytes4 selector, bytes calldata data) external;
}
