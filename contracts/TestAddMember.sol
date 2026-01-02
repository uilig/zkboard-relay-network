// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ISemaphore {
    function addMember(uint256 groupId, uint256 identityCommitment) external;
}

contract TestAddMember {
    ISemaphore public semaphore;
    uint256 public groupId;

    event MemberAdded(uint256 commitment);

    constructor(address _semaphore, uint256 _groupId) {
        semaphore = ISemaphore(_semaphore);
        groupId = _groupId;
    }

    function testAdd(uint256 commitment) external {
        semaphore.addMember(groupId, commitment);
        emit MemberAdded(commitment);
    }
}
