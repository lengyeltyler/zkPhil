// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "solady/src/tokens/ERC721.sol";
import {LibString} from "solady/src/utils/LibString.sol";
import {IProofGate} from "./IProofGate.sol";

/// @title Phil369CadenceMint
/// @notice 369 supply mint module with 36-hour cadence + owner-assigned window minter.
/// @dev Reserve mint path is proof-gated and does not consume the cadence slot.
contract Phil369CadenceMint is ERC721 {
    using LibString for uint256;

    uint8 internal constant ACTION_CADENCE_MINT = 4;
    uint8 internal constant ACTION_CADENCE_RESERVE = 5;

    uint256 public constant MAX_SUPPLY = 369;
    uint256 public constant RESERVE_CAP = 69;
    uint256 public constant CADENCE_WINDOW = 36 hours;

    IProofGate public immutable gate;

    address public owner;
    uint256 public totalSupply;
    uint256 public reserveMinted;

    uint256 public nextMintTime;
    address public windowMinter;

    uint256 public currentVersionId;
    mapping(uint256 => uint256) public versionIdOf;
    mapping(uint256 => string) private _versionBaseUri;

    event WindowMinterAssigned(address indexed minter, uint256 indexed eligibleAt);
    event CadenceMinted(uint256 indexed tokenId, address indexed minter, uint256 indexed versionId);
    event ReserveMinted(uint256 indexed tokenId, address indexed to, uint256 indexed versionId);
    event VersionUpdated(uint256 indexed versionId);
    event VersionBaseURIUpdated(uint256 indexed versionId, string baseURI);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotWindowMinter();
    error CadenceLocked();
    error SoldOut();
    error ReserveCapReached();
    error InvalidRecipient();

    constructor(address gate_) {
        gate = IProofGate(gate_);
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function name() public pure override returns (string memory) {
        return "Phil 369";
    }

    function symbol() public pure override returns (string memory) {
        return "PHIL369";
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidRecipient();
        address previous = owner;
        owner = newOwner;
        emit OwnershipTransferred(previous, newOwner);
    }

    function setCurrentVersionId(uint256 versionId) external onlyOwner {
        currentVersionId = versionId;
        emit VersionUpdated(versionId);
    }

    function setVersionBaseURI(uint256 versionId, string calldata baseURI) external onlyOwner {
        _versionBaseUri[versionId] = baseURI;
        emit VersionBaseURIUpdated(versionId, baseURI);
    }

    function assignWindowMinter(address minter) external onlyOwner {
        windowMinter = minter;
        emit WindowMinterAssigned(minter, nextMintTime);
    }

    function mint(IProofGate.MintProof calldata proof) external {
        if (msg.sender != windowMinter) revert NotWindowMinter();
        if (block.timestamp < nextMintTime) revert CadenceLocked();

        uint256 tokenId = totalSupply;
        if (tokenId >= MAX_SUPPLY) revert SoldOut();

        bytes32 actionHash = computeCadenceMintActionHash(msg.sender, tokenId, currentVersionId);
        gate.verifyActionAndConsume(msg.sender, ACTION_CADENCE_MINT, actionHash, proof);

        unchecked {
            totalSupply = tokenId + 1;
        }
        versionIdOf[tokenId] = currentVersionId;

        _mint(msg.sender, tokenId);

        nextMintTime = block.timestamp + CADENCE_WINDOW;
        windowMinter = address(0);

        emit CadenceMinted(tokenId, msg.sender, currentVersionId);
    }

    function reserveMint(address to, IProofGate.MintProof calldata proof) external onlyOwner {
        if (to == address(0)) revert InvalidRecipient();
        if (reserveMinted >= RESERVE_CAP) revert ReserveCapReached();

        uint256 tokenId = totalSupply;
        if (tokenId >= MAX_SUPPLY) revert SoldOut();

        bytes32 actionHash = computeReserveMintActionHash(to, tokenId, currentVersionId);
        gate.verifyActionAndConsume(to, ACTION_CADENCE_RESERVE, actionHash, proof);

        unchecked {
            reserveMinted += 1;
            totalSupply = tokenId + 1;
        }
        versionIdOf[tokenId] = currentVersionId;

        _mint(to, tokenId);
        emit ReserveMinted(tokenId, to, currentVersionId);
    }

    function computeCadenceMintActionHash(
        address minter,
        uint256 tokenId,
        uint256 versionId
    ) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), minter, tokenId, versionId, false));
    }

    function computeReserveMintActionHash(
        address to,
        uint256 tokenId,
        uint256 versionId
    ) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), to, tokenId, versionId, true));
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        if (!_exists(tokenId)) revert TokenDoesNotExist();

        uint256 versionId = versionIdOf[tokenId];
        string memory base = _versionBaseUri[versionId];
        if (bytes(base).length != 0) {
            return string.concat(base, tokenId.toString());
        }

        return string.concat(
            "data:application/json;utf8,{\"name\":\"Phil 369 #",
            tokenId.toString(),
            "\",\"attributes\":[{\"trait_type\":\"versionId\",\"value\":\"",
            versionId.toString(),
            "\"}]}"
        );
    }
}
