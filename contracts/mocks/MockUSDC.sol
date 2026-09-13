// SPDX-License-Identifier: MIT
// Local test double for Arc's native USDC (6 decimals). Never deployed to
// Arc testnet/mainnet — there the real USDC at 0x3600...0000 is used.
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {
        _mint(msg.sender, 1_000_000 * 10 ** decimals());
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
