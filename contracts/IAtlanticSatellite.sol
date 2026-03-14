// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IAtlanticSatellite
/// @notice DEPRECATED — Atlantic fact registry interface.
/// @dev This interface is not used by any active Phil contract.
///      The project uses SHARP (StarkWare Proving Service) via ISharpFactRegistry.
///      This file is retained for reference only and will be removed in a future cleanup.
interface IAtlanticSatellite {
    /// @notice Check if a Cairo program execution fact is valid
    /// @param factHash The hash of the fact to verify
    /// @return True if the fact has been proven and registered
    function isValid(bytes32 factHash) external view returns (bool);
}
