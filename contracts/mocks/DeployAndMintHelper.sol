// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IPhilAccountFactoryLike {
    function createPhilAccount(address owner, uint256 starkPubKeyX) external returns (address);
}

interface IPhilMintLike {
    function mint(
        address recipient,
        address mintTo,
        uint8 paletteId,
        uint8 decalId,
        uint8 outlineId,
        uint8 spikesShape,
        uint8 bodyShape,
        uint8 teethShape,
        bytes32 factHash,
        uint256[6] calldata outputs
    ) external;
}

contract DeployAndMintHelper {
    function deployAndMint(
        address factory,
        address mintContract,
        address recipient,
        uint256 starkPubKeyX,
        uint8 paletteId,
        uint8 decalId,
        uint8 outlineId,
        uint8 spikesShape,
        uint8 bodyShape,
        uint8 teethShape,
        bytes32 factHash,
        uint256[6] calldata outputs
    ) external returns (address account) {
        account = IPhilAccountFactoryLike(factory).createPhilAccount(recipient, starkPubKeyX);
        IPhilMintLike(mintContract).mint(
            recipient,
            account,
            paletteId,
            decalId,
            outlineId,
            spikesShape,
            bodyShape,
            teethShape,
            factHash,
            outputs
        );
    }
}
