pragma solidity 0.5.16;

import "../helpers/DecimalMath.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "../modules/Griefing.sol";
import "../modules/EventMetadata.sol";
import "../modules/Operated.sol";
import "../modules/Template.sol";

/// @title SimpleGriefingWithFees
/// @author Noah Harasz (@ndharasz) for Numerai Inc
/// @dev Security contact: security@numer.ai
/// @dev Version: 1.3.0
/// @dev State Machine: https://github.com/erasureprotocol/erasure-protocol/blob/release/v1.3.x/docs/state-machines/agreements/SimpleGriefing.png
/// @notice This agreement template allows a staker to grant permission to a counterparty to punish, reward, or release their stake.
///         A new instance is initialized by the factory using the `initData` received. See the `initialize()` function for details on initialization parameters.
///         Notable features:
///             - The staker can increase the stake at any time.
///             - The counterparty can increase, release, or punish the stake at any time.
///             - The beneficiaries can increase stake at any time
///             - The agreement can be terminated by the counterparty by releasing or punishing the full stake amount. Note it is always possible for the staker to increase their stake again.
///             - Punishments use griefing which requires the counterparty to pay an appropriate amount based on the desired punishment and a predetermined ratio.
///             - An operator can optionally be defined to grant full permissions to a trusted external address or contract.

contract SimpleGriefingWithFees is Griefing, EventMetadata, Operated, Template {

    using SafeMath for uint256;

    Data private _data;
    struct Data {
        address staker;
        address counterparty;
        uint256 totalStakeTokens;
        mapping (address => uint256) stakeholders;
        uint256 feeRatio;
        uint256 managementFee;
    }

    event Initialized(
        address operator,
        address staker,
        address counterparty,
        TokenManager.Tokens tokenID,
        uint256 ratio,
        Griefing.RatioType ratioType,
        uint256 feeRatio,
        uint256 managementFee,
        bytes metadata
    );

    /// @notice Constructor used to initialize the agreement parameters.
    ///         All parameters are passed as ABI-encoded calldata to the factory. This calldata must include the function selector.
    /// @dev Access Control: only factory
    ///      State Machine: before all
    /// @param operator address of the operator that overrides access control. Optional parameter. Passing the address(0) will disable operator functionality.
    /// @param staker address of the staker who owns the stake. Required parameter. This address is the only one able to retrieve the stake and cannot be changed.
    /// @param counterparty address of the counterparty who has the right to reward, release, and punish the stake. Required parameter. This address cannot be changed.
    /// @param tokenID TokenManager.Tokens ID of the ERC20 token. Required parameter. This ID must be one of the IDs supported by TokenManager.
    /// @param ratio uint256 number (18 decimals) used to determine punishment cost. Required parameter. See Griefing module for details on valid input.
    /// @param ratioType Griefing.RatioType number used to determine punishment cost. Required parameter. See Griefing module for details on valid input.
    /// @param metadata bytes data (any format) to emit as event on initialization. Optional parameter.
    function initialize(
        address operator,
        address staker,
        address counterparty,
        TokenManager.Tokens tokenID,
        uint256 ratio,
        Griefing.RatioType ratioType,
        uint256 feeRatio,
        uint256 managementFee,
        bytes memory metadata
    ) public initializeTemplate() {
        // set storage values
        _data.staker = staker;
        _data.counterparty = counterparty;
        _data.feeRatio = feeRatio;
        _data.managementFee = managementFee;

        // set operator
        if (operator != address(0)) {
            Operated._setOperator(operator);
        }

        // set griefing ratio
        Griefing._setRatio(staker, tokenID, ratio, ratioType);

        // set metadata
        if (metadata.length != 0) {
            EventMetadata._setMetadata(metadata);
        }

        // log initialization params
        emit Initialized(
            operator,
            staker,
            counterparty,
            tokenID,
            ratio,
            ratioType,
            feeRatio,
            managementFee,
            metadata
        );
    }

    // state functions

    /// @notice Emit metadata event
    /// @dev Access Control: operator
    ///      State Machine: always
    /// @param metadata bytes data (any format) to emit as event
    function setMetadata(bytes memory metadata) public {
        // restrict access
        require(Operated.isOperator(msg.sender), "only operator");

        // update metadata
        EventMetadata._setMetadata(metadata);
    }

    /// @notice Called by the staker to increase the stake
    ///          - tokens (ERC-20) are transfered from the caller and requires approval of this contract for appropriate amount
    /// @dev Access Control: staker OR operator
    ///      State Machine: anytime
    /// @param amountToAdd uint256 amount of tokens (18 decimals) to be added to the stake
    function increaseStake(uint256 amountToAdd) public {
        require(!isCounterparty(msg.sender), "only stakeholder or operator");

        // add stake
        address staker = _data.staker;
        TokenManager.Tokens tokenID = Griefing.getTokenID(staker);
        uint256 totalValue = Deposit.getDeposit(tokenID, staker);
        Staking._addStake(tokenID, staker, msg.sender, amountToAdd);

        // generate stake tokens
        uint256 tokensToAdd = 1e18;
        if (totalValue > 0) {
            tokensToAdd = DecimalMath.mul(_data.totalStakeTokens, DecimalMath.div(amountToAdd, totalValue));
        }
        address stakeholder;
        if (isOperator(msg.sender)) {
            stakeholder = staker;
        } else {
            stakeholder = msg.sender;
        }
        _data.stakeholders[stakeholder] = SafeMath.add(_data.stakeholders[stakeholder], tokensToAdd);
        _data.totalStakeTokens = SafeMath.add(_data.totalStakeTokens, tokensToAdd);
    }

    /// @notice Called by the staker to increase the stake
    ///          - tokens (ERC-20) are transfered from the caller and requires approval of this contract for appropriate amount
    /// @dev Access Control: staker OR operator
    ///      State Machine: anytime
    /// @param tokensToRedeem uint256 amount of stakeTokens (18 decimals) to be redeemed for stake
    function redeemStake(uint256 tokensToRedeem, address stakeholder) public {
        // restrict access
        require(isCounterparty(msg.sender) || Operated.isOperator(msg.sender), "only counterparty or operator");

        // declare variable in memory
        address staker = _data.staker;
        TokenManager.Tokens tokenID = Griefing.getTokenID(staker);

        uint256 totalValue = Deposit.getDeposit(tokenID, staker);
        require(totalValue > 0, "no stake left to redeem");

        uint256 userTokensAvailable = _data.stakeholders[stakeholder];
        require(userTokensAvailable >= tokensToRedeem, "cannot redeem more stake than you have");

        uint256 nmrToRedeem = DecimalMath.mul(totalValue, DecimalMath.div(tokensToRedeem, _data.totalStakeTokens));

        // redeem stake
        Staking._takeStake(Griefing.getTokenID(staker), staker, stakeholder, nmrToRedeem);

        // remove stake tokens
        _data.stakeholders[stakeholder] = SafeMath.sub(_data.stakeholders[stakeholder], tokensToRedeem);
        _data.totalStakeTokens = SafeMath.sub(_data.totalStakeTokens, tokensToRedeem);
    }


    /// @notice Called by the counterparty to increase the stake
    ///          - tokens (ERC-20) are transfered from the caller and requires approval of this contract for appropriate amount
    /// @dev Access Control: counterparty OR operator
    ///      State Machine: anytime
    /// @param amountToAdd uint256 amount of tokens (18 decimals) to be added to the stake
    function reward(uint256 amountToAdd) public {
        // restrict access
        require(isCounterparty(msg.sender) || Operated.isOperator(msg.sender), "only counterparty or operator");

        // declare variable in memory
        address staker = _data.staker;
        TokenManager.Tokens tokenID = Griefing.getTokenID(staker);
        uint256 totalValue = Deposit.getDeposit(tokenID, staker);

        // give some proportion of stake tokens to the staker to represent their increased share
        // tokenInflation = totalStakeTokens * feeRatio * (amountToAdd / totalValue)
        uint256 tokenInflation = DecimalMath.mul(_data.totalStakeTokens,
            DecimalMath.mul(_data.feeRatio, DecimalMath.div(amountToAdd, totalValue))
        );
        _data.stakeholders[staker] = SafeMath.add(_data.stakeholders[staker], tokenInflation);
        _data.totalStakeTokens = SafeMath.add(_data.totalStakeTokens, tokenInflation);

        // add stake
        Staking._addStake(Griefing.getTokenID(staker), staker, msg.sender, amountToAdd);
    }

    /// @notice Called by the counterparty to punish the stake
    ///          - burns the punishment from the stake and a proportional amount from the counterparty balance
    ///          - the cost of the punishment is calculated with the `Griefing.getCost()` function using the predetermined griefing ratio
    ///          - tokens (ERC-20) are burned from the caller and requires approval of this contract for appropriate amount
    /// @dev Access Control: counterparty OR operator
    ///      State Machine: anytime
    /// @param punishment uint256 amount of tokens (18 decimals) to be burned from the stake
    /// @param message bytes data (any format) to emit as event giving reason for the punishment
    /// @return cost uint256 amount of tokens (18 decimals) it cost to perform punishment
    function punish(uint256 punishment, bytes memory message) public returns (uint256 cost) {
        // restrict access
        require(isCounterparty(msg.sender) || Operated.isOperator(msg.sender), "only counterparty or operator");

        // declare variable in memory
        address staker = _data.staker;
        TokenManager.Tokens tokenID = Griefing.getTokenID(staker);
        uint256 totalValue = Deposit.getDeposit(tokenID, staker);

        // give some proportion of stake tokens to the staker to represent their increased share
        // tokenDeflation = totalStakeTokens * feeRatio * (punishment / totalValue)
        uint256 tokenDeflation = DecimalMath.mul(_data.totalStakeTokens,
            DecimalMath.mul(_data.feeRatio, DecimalMath.div(punishment, totalValue))
        );
        _data.stakeholders[staker] = SafeMath.sub(_data.stakeholders[staker], tokenDeflation);
        _data.totalStakeTokens = SafeMath.sub(_data.totalStakeTokens, tokenDeflation);

        // execute griefing
        cost = Griefing._grief(msg.sender, staker, punishment, message);
    }

    function distributeManagementFee() public {
        // restrict access
        require(isCounterparty(msg.sender) || Operated.isOperator(msg.sender), "only counterparty or operator");

        // declare variable in memory
        address staker = _data.staker;

        // inflate tokens by managementFee * totalStakeTokens
        uint256 inflation = _data.managementFee.mul(_data.totalStakeTokens);
        _data.stakeholders[staker] = _data.stakeholders[staker].add(inflation);
        _data.totalStakeTokens = _data.totalStakeTokens.add(inflation);
    }

    /// @notice Called by the operator to transfer control to new operator
    /// @dev Access Control: operator
    ///      State Machine: anytime
    /// @param operator address of the new operator
    function transferOperator(address operator) public {
        // restrict access
        require(Operated.isOperator(msg.sender), "only operator");

        // transfer operator
        Operated._transferOperator(operator);
    }

    /// @notice Called by the operator to renounce control
    /// @dev Access Control: operator
    ///      State Machine: anytime
    function renounceOperator() public {
        // restrict access
        require(Operated.isOperator(msg.sender), "only operator");

        // renounce operator
        Operated._renounceOperator();
    }

    // view functions

    /// @notice Get the address of the staker (if set)
    /// @return staker address of the staker
    function getStaker() public view returns (address staker) {
        return _data.staker;
    }

    /// @notice Validate if the address matches the stored staker address
    /// @param caller address to validate
    /// @return validity bool true if matching address
    function isStaker(address caller) internal view returns (bool validity) {
        return caller == getStaker();
    }

    /// @notice Get the address of the counterparty (if set)
    /// @return counterparty address of counterparty account
    function getCounterparty() public view returns (address counterparty) {
        return _data.counterparty;
    }

    /// @notice Validate if the address matches the stored counterparty address
    /// @param caller address to validate
    /// @return validity bool true if matching address
    function isCounterparty(address caller) internal view returns (bool validity) {
        return caller == getCounterparty();
    }

    /// @notice Get the token ID and address used by the agreement
    /// @return tokenID TokenManager.Tokens ID of the ERC20 token.
    /// @return token address of the ERC20 token.
    function getToken() public view returns (TokenManager.Tokens tokenID, address token) {
        tokenID = Griefing.getTokenID(_data.staker);
        return (tokenID, TokenManager.getTokenAddress(tokenID));
    }

    /// @notice Get the current stake of the agreement
    /// @return stake uint256 amount of tokens (18 decimals) staked.
    function getStake() public view returns (uint256 stake) {
        return Deposit.getDeposit(Griefing.getTokenID(_data.staker), _data.staker);
    }

    enum AgreementStatus { isInitialized, isStaked }
    /// @notice Get the status of the state machine
    /// @return status AgreementStatus from the following states:
    ///          - isInitialized: initialized but no deposits made
    ///          - isStaked: stake is deposited
    function getAgreementStatus() public view returns (AgreementStatus status) {
        uint256 currentStake = getStake();
        if (currentStake > 0) {
            return AgreementStatus.isStaked;
        } else {
            return AgreementStatus.isInitialized;
        }
    }

    /// @notice Validate if the state machine is in the AgreementStatus.isInitialized state
    /// @return validity bool true if correct state
    function isInitialized() internal view returns (bool validity) {
        return getAgreementStatus() == AgreementStatus.isInitialized;
    }

    /// @notice Validate if the state machine is in the AgreementStatus.isStaked state
    /// @return validity bool true if correct state
    function isStaked() internal view returns (bool validity) {
        return getAgreementStatus() == AgreementStatus.isStaked;
    }

    /// @notice Get the total number of stake tokens assigned to stakeholders
    /// @return tokens uint256 total stake tokens
    function getTotalStakeTokens() public view returns (uint256 tokens) {
        return _data.totalStakeTokens;
    }

    /// @notice Get the number of stake tokens assigned to given stakeholde
    /// @param stakeholder address for which to get tokens
    /// @return tokens uint256 number of tokens for this stakeholder
    function getStakeholderValue(address stakeholder) public view returns (uint256 tokens) {
        address staker = _data.staker;
        uint256 totalValue = Deposit.getDeposit(Griefing.getTokenID(staker), staker);
        if (totalValue > 0) {
            return _data.stakeholders[stakeholder].div(_data.totalStakeTokens).mul(totalValue);
        } else {
            return 0;
        }
    }

    /// @notice Get the number of stake tokens assigned to given stakeholde
    /// @param stakeholder address for which to get tokens
    /// @return tokens uint256 number of tokens for this stakeholder
    function getStakeholderTokens(address stakeholder) public view returns (uint256 tokens) {
        return _data.stakeholders[stakeholder];
    }
}
