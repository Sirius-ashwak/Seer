// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {SeerPoints} from "../src/SeerPoints.sol";

contract SeerPointsTest is Test {
    SeerPoints internal points;
    address internal constant OWNER = address(0xA11CE);
    address internal constant ALICE = address(0xBEEF);
    address internal constant BOB = address(0xCAFE);

    function setUp() public {
        points = new SeerPoints(OWNER);
    }

    function test_metadata() public view {
        assertEq(points.name(), "SEER Points");
        assertEq(points.symbol(), "SEER");
        assertEq(points.decimals(), 18);
        assertEq(points.owner(), OWNER);
    }

    function test_mint_increasesBalanceAndSupply() public {
        vm.prank(OWNER);
        points.mint(ALICE, 1_000 ether);

        assertEq(points.balanceOf(ALICE), 1_000 ether);
        assertEq(points.totalSupply(), 1_000 ether);
    }

    function test_burn_decreasesBalanceAndSupply() public {
        vm.startPrank(OWNER);
        points.mint(ALICE, 1_000 ether);
        points.burn(ALICE, 400 ether);
        vm.stopPrank();

        assertEq(points.balanceOf(ALICE), 600 ether);
        assertEq(points.totalSupply(), 600 ether);
    }

    function test_transfer_reverts() public {
        vm.prank(OWNER);
        points.mint(ALICE, 100 ether);

        vm.prank(ALICE);
        vm.expectRevert(SeerPoints.Soulbound.selector);
        points.transfer(BOB, 1);
    }

    function test_transferFrom_reverts() public {
        vm.prank(ALICE);
        vm.expectRevert(SeerPoints.Soulbound.selector);
        points.transferFrom(ALICE, BOB, 1);
    }

    function test_approve_reverts() public {
        vm.prank(ALICE);
        vm.expectRevert(SeerPoints.Soulbound.selector);
        points.approve(BOB, 1);
    }

    function test_mint_onlyOwner() public {
        vm.prank(ALICE);
        vm.expectRevert(SeerPoints.NotOwner.selector);
        points.mint(ALICE, 1);
    }

    function test_burn_onlyOwner() public {
        vm.prank(OWNER);
        points.mint(ALICE, 100 ether);

        vm.prank(ALICE);
        vm.expectRevert(SeerPoints.NotOwner.selector);
        points.burn(ALICE, 1);
    }

    function test_burn_revertsOnInsufficientBalance() public {
        vm.prank(OWNER);
        vm.expectRevert(SeerPoints.InsufficientBalance.selector);
        points.burn(ALICE, 1);
    }

    function test_setOperator_onlyOwner() public {
        vm.prank(ALICE);
        vm.expectRevert(SeerPoints.NotOwner.selector);
        points.setOperator(BOB, true);
    }

    function test_operatorTransfer_movesBalanceBypassingSoulbound() public {
        vm.startPrank(OWNER);
        points.mint(ALICE, 100 ether);
        points.setOperator(BOB, true);
        vm.stopPrank();

        vm.prank(BOB);
        points.operatorTransfer(ALICE, BOB, 40 ether);

        assertEq(points.balanceOf(ALICE), 60 ether);
        assertEq(points.balanceOf(BOB), 40 ether);
    }

    function test_operatorTransfer_revertsIfNotOperator() public {
        vm.prank(OWNER);
        points.mint(ALICE, 100 ether);

        vm.prank(BOB);
        vm.expectRevert(SeerPoints.NotOperator.selector);
        points.operatorTransfer(ALICE, BOB, 1);
    }

    function test_operatorTransfer_revertsAfterRevocation() public {
        vm.startPrank(OWNER);
        points.mint(ALICE, 100 ether);
        points.setOperator(BOB, true);
        points.setOperator(BOB, false);
        vm.stopPrank();

        vm.prank(BOB);
        vm.expectRevert(SeerPoints.NotOperator.selector);
        points.operatorTransfer(ALICE, BOB, 1);
    }

    function test_operatorTransfer_insufficientBalanceReverts() public {
        vm.prank(OWNER);
        points.setOperator(BOB, true);

        vm.prank(BOB);
        vm.expectRevert(SeerPoints.InsufficientBalance.selector);
        points.operatorTransfer(ALICE, BOB, 1);
    }

    function test_transferStillRevertsEvenForOperator() public {
        vm.startPrank(OWNER);
        points.mint(ALICE, 100 ether);
        points.setOperator(ALICE, true);
        vm.stopPrank();

        // Operator role doesn't unlock the regular transfer path.
        vm.prank(ALICE);
        vm.expectRevert(SeerPoints.Soulbound.selector);
        points.transfer(BOB, 1);
    }

    function test_ownershipHandover_twoStep() public {
        address newOwner = address(0xDA0);

        vm.prank(OWNER);
        points.transferOwnership(newOwner);
        assertEq(points.owner(), OWNER, "owner not changed until accepted");
        assertEq(points.pendingOwner(), newOwner);

        vm.prank(newOwner);
        points.acceptOwnership();
        assertEq(points.owner(), newOwner);
        assertEq(points.pendingOwner(), address(0));
    }
}
