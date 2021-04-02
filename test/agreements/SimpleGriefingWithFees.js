const web3 = require('web3')
const { RATIO_TYPES, TOKEN_TYPES } = require('../helpers/variables')
const { abiEncodeWithSelector } = require('../helpers/utils')

const SimpleGriefingWithFeesArtifact = require('../../build/SimpleGriefingWithFees.json')
const SimpleGriefingWithFeesFactoryArtifact = require('../../build/SimpleGriefingWithFees_Factory.json')
const AgreementsRegistryArtifact = require('../../build/Erasure_Agreements.json')
const MockNMRArtifact = require('../../build/MockNMR.json')

describe('SimpleGriefingWithFees', function() {
  // wallets and addresses
  const [
    operatorWallet,
    counterpartyWallet,
    stakerWallet,
    newOperatorWallet,
  ] = accounts
  const operator = operatorWallet.signer.signingKey.address
  const counterparty = counterpartyWallet.signer.signingKey.address
  const staker = stakerWallet.signer.signingKey.address
  const newOperator = newOperatorWallet.signer.signingKey.address

  // variables used in initialize()
  const tokenID = TOKEN_TYPES.NMR
  const stakerStake = ethers.utils.parseEther('200')
  const punishment = ethers.utils.parseEther('100')
  const ratio = 2
  const ratioE18 = ethers.utils.parseEther(ratio.toString())
  const ratioType = RATIO_TYPES.Dec
  const feeRatio = ethers.utils.parseEther('10')
  const mgmtFee = ethers.utils.parseEther('10')
  const staticMetadata = 'TESTING'
  let currentStake // to increment as we go

  const createABITypes = [
    'address',
    'address',
    'address',
    'uint8',
    'uint256',
    'uint8',
    'uint256',
    'uint256',
    'bytes',
  ]

  const initArgs = [
    operator,
    staker,
    counterparty,
    tokenID,
    ratioE18,
    ratioType,
    feeRatio,
    mgmtFee,
    Buffer.from(staticMetadata),
  ]

  // helper function to deploy TestSimpleGriefingWithFees
  const deployAgreement = async (args = initArgs) => {
    const callData = abiEncodeWithSelector('initialize', createABITypes, args)
    const txn = await this.Factory.from(operator).create(callData)

    const receipt = await this.Factory.verboseWaitForTransaction(txn)

    const eventLogs = utils.parseLogs(receipt, this.Factory, 'InstanceCreated')
    assert.equal(eventLogs.length, 1)

    const [event] = eventLogs
    const agreementAddress = event.instance

    const contract = deployer.wrapDeployedContract(
      SimpleGriefingWithFeesArtifact,
      agreementAddress,
      operatorWallet.secretKey,
    )

    return contract
  }
  const deployDeactivatedAgreement = async () => {
    const agreement = await deployAgreement()
    await agreement.from(operator).renounceOperator()
    return agreement
  }

  before(async () => {
    this.SimpleGriefingWithFees = await deployer.deploy(SimpleGriefingWithFeesArtifact)
    this.Registry = await deployer.deploy(AgreementsRegistryArtifact)
    this.Factory = await deployer.deploy(
      SimpleGriefingWithFeesFactoryArtifact,
      false,
      this.Registry.contractAddress,
      this.SimpleGriefingWithFees.contractAddress,
    )
    await this.Registry.from(deployer.signer).addFactory(
      this.Factory.contractAddress,
      '0x',
    )
    this.DeactivatedGriefing = await deployDeactivatedAgreement()

    // fill the token balances of the counterparty and staker
    // counterparty & staker has 1,000 * 10^18 each
    const startingBalance = '1000'
    await NMR.from(counterparty).mintMockTokens(
      counterparty,
      ethers.utils.parseEther(startingBalance),
    )
    await NMR.from(staker).mintMockTokens(
      staker,
      ethers.utils.parseEther(startingBalance),
    )
  })

  describe('SimpleGriefingWithFees.initialize', () => {
    it('should initialize contract', async () => {
      this.TestSimpleGriefingWithFees = await deployAgreement()

      // check that SimpleGriefingWithFees do not have Countdown contract attributes
      // getLength should not be present in SimpleGriefingWithFees
      assert.strictEqual(this.SimpleGriefingWithFees.getLength, undefined)
      assert.strictEqual(this.SimpleGriefingWithFees.startCountdown, undefined)

      // check that it's the TestSimpleGriefingWithFees state that is changed
      // not the SimpleGriefingWithFees logic contract's state

      // check all the state changes

      // Staking._setToken
      const [token] = await this.TestSimpleGriefingWithFees.getToken()
      assert.equal(token, tokenID)

      // _data.staker
      const getStaker = await this.TestSimpleGriefingWithFees.getStaker()
      assert.equal(getStaker, staker)

      // _data.counterparty
      const getCounterparty = await this.TestSimpleGriefingWithFees.getCounterparty()
      assert.equal(getCounterparty, counterparty)

      // Operator._setOperator
      const operator = await this.TestSimpleGriefingWithFees.getOperator()
      assert.equal(operator, operator)

      // Griefing._setRatio
      const [
        actualRatio,
        actualRatioType,
      ] = await this.TestSimpleGriefingWithFees.getRatio(staker)
      assert.equal(actualRatio.toString(), ratioE18.toString())
      assert.equal(actualRatioType, ratioType)

      assert.equal(await this.TestSimpleGriefingWithFees.getTotalStakeTokens(), 0)
      assert.equal(await this.TestSimpleGriefingWithFees.getStakeholderValue(staker), 0)
    })

    it('should revert when not initialized from constructor', async () => {
      await assert.revertWith(
        this.TestSimpleGriefingWithFees.initialize(...initArgs),
        'must be called within contract constructor',
      )
    })
  })

  describe('SimpleGriefingWithFees.setMetadata', () => {
    const stakerMetadata = 'STAKER'
    const operatorMetadata = 'OPERATOR'

    it('should revert when msg.sender is active operator', async () => {
      // use the counterparty to be the msg.sender
      await assert.revertWith(
        this.TestSimpleGriefingWithFees.from(counterparty).setMetadata(
          Buffer.from(stakerMetadata),
        ),
        'only operator',
      )
    })

    it('should revert when msg.sender is deactivated operator', async () => {
      await assert.revertWith(
        this.DeactivatedGriefing.from(operator).setMetadata(
          Buffer.from(stakerMetadata),
        ),
        'only operator',
      )
    })

    it('should set metadata when msg.sender is operator', async () => {
      const txn = await this.TestSimpleGriefingWithFees.from(operator).setMetadata(
        Buffer.from(operatorMetadata),
      )
      await assert.emitWithArgs(
        txn,
        'MetadataSet',
        ethers.utils.hexlify(ethers.utils.toUtf8Bytes(operatorMetadata)),
      )
    })
  })

// TODO: add 3rd party stakers
  describe('SimpleGriefingWithFees.increaseStake', () => {
    let DEFAULT_AMOUNT = 500 // 500 token weis

    const increaseStake = async (sender, amountToAdd) => {
      const initialVal = web3.utils.hexToNumberString(
          (await this.TestSimpleGriefingWithFees.getStakeholderValue(staker))._hex
      )
      await NMR.from(sender).approve(
        this.TestSimpleGriefingWithFees.contractAddress,
        amountToAdd,
      )

      const txn = await this.TestSimpleGriefingWithFees.from(sender).increaseStake(
        amountToAdd,
      )

      currentStake += amountToAdd

      const receipt = await this.TestSimpleGriefingWithFees.verboseWaitForTransaction(
        txn,
      )
      const depositIncreasedEvent = receipt.events.find(
        emittedEvent => emittedEvent.event === 'DepositIncreased',
        'There is no such event',
      )

      assert.isDefined(depositIncreasedEvent)
      assert.equal(depositIncreasedEvent.args.tokenID, tokenID)
      assert.equal(depositIncreasedEvent.args.user, staker)
      assert.equal(depositIncreasedEvent.args.amount.toNumber(), amountToAdd)
      await assert.equal(
        web3.utils.hexToNumberString(await this.TestSimpleGriefingWithFees.getTotalStakeTokens()),
        web3.utils.hexToNumberString(await this.TestSimpleGriefingWithFees.getStakeholderTokens(staker))
      )
      console.log(web3.utils.hexToNumberString(await this.TestSimpleGriefingWithFees.getStakeholderTokens(staker)))
      await assert.equal(
        web3.utils.hexToNumberString(await this.TestSimpleGriefingWithFees.getStakeholderTokens(staker)),
        web3.utils.toWei((currentStake/amountToAdd).toString())
      )
      await assert.equal(
        web3.utils.hexToNumberString(await this.TestSimpleGriefingWithFees.getStakeholderValue(staker)),
        currentStake,
      )
    }

    it('should revert when msg.sender is counterparty', async () => {
      // update currentStake
      currentStake = (await this.TestSimpleGriefingWithFees.getStake()).toNumber()

      // use the counterparty to be the msg.sender
      assert.revertWith(
        this.TestSimpleGriefingWithFees.from(counterparty).increaseStake(DEFAULT_AMOUNT),
        'only stakeholder or operator'
      )
    })

    it('should increase when msg.sender is deactivated operator (3rd party)', async () => {
      await NMR.from(operator).approve(
        this.DeactivatedGriefing.contractAddress,
        DEFAULT_AMOUNT,
      )
      await this.DeactivatedGriefing.from(operator).increaseStake(DEFAULT_AMOUNT, {
        gasLimit: 3000000,
      })
      await assert.equal(
        web3.utils.hexToNumberString(await this.DeactivatedGriefing.getTotalStakeTokens()),
        web3.utils.hexToNumberString(await this.DeactivatedGriefing.getStakeholderTokens(operator))
      )
      await assert.equal(
        web3.utils.hexToNumberString(await this.DeactivatedGriefing.getStakeholderValue(operator)),
        DEFAULT_AMOUNT,
      )
    })

    it('should increase stake when msg.sender is staker', async () => {
      await increaseStake(staker, DEFAULT_AMOUNT)
    })

    it('should increase stake when msg.sender is operator', async () => {
      await increaseStake(operator, 100)
    })
  })

// TODO: check fee calc
  describe('SimpleGriefingWithFees.reward', () => {
    let currentStake // to increment as we go
    let amountToAdd = 500 // 500 token weis

    const reward = async sender => {
      const initialVal = web3.utils.hexToNumberString(
          (await this.TestSimpleGriefingWithFees.getStakeholderValue(staker))._hex
      )
      // update currentStake
      currentStake = (await this.TestSimpleGriefingWithFees.getStake()).toNumber()

      await NMR.from(sender).approve(
        this.TestSimpleGriefingWithFees.contractAddress,
        amountToAdd,
      )

      console.log(web3.utils.toWei(web3.utils.hexToNumberString(
        await this.TestSimpleGriefingWithFees.getTotalStakeTokens()
      )))
      const txn = await this.TestSimpleGriefingWithFees.from(sender).reward(amountToAdd)

      currentStake += amountToAdd

      assert.equal(
        (await this.TestSimpleGriefingWithFees.getStake()).toNumber(),
        currentStake,
      )

      const receipt = await this.TestSimpleGriefingWithFees.verboseWaitForTransaction(
        txn,
      )
      const depositIncreasedEvent = receipt.events.find(
        emittedEvent => emittedEvent.event === 'DepositIncreased',
        'There is no such event',
      )

      assert.isDefined(depositIncreasedEvent)
      assert.equal(depositIncreasedEvent.args.tokenID, tokenID)
      assert.equal(depositIncreasedEvent.args.user, staker)
      assert.equal(depositIncreasedEvent.args.amount.toNumber(), amountToAdd)
      await assert.equal(
        web3.utils.hexToNumberString(await this.TestSimpleGriefingWithFees.getTotalStakeTokens()),
        web3.utils.hexToNumberString(await this.TestSimpleGriefingWithFees.getStakeholderTokens(staker))
      )
      assert.equal(
        web3.utils.hexToNumberString(await this.TestSimpleGriefingWithFees.getStakeholderValue(staker)),
        currentStake
      )

      console.log(web3.utils.toWei(web3.utils.hexToNumberString(
        await this.TestSimpleGriefingWithFees.getTotalStakeTokens()
      )))

      console.log(web3.utils.toWei(web3.utils.hexToNumberString(
        await this.TestSimpleGriefingWithFees.getTotalStakeTokens()
      ))*mgmtFee)
      await this.TestSimpleGriefingWithFees.from(operator).distributeManagementFee()
      console.log(web3.utils.toWei(web3.utils.hexToNumberString(
        await this.TestSimpleGriefingWithFees.getTotalStakeTokens()
      )))
    }

    it('should revert when msg.sender is staker', async () => {
      // update currentStake
      currentStake = (await this.TestSimpleGriefingWithFees.getStake()).toNumber()

      // use the staker to be the msg.sender
      await assert.revertWith(
        this.TestSimpleGriefingWithFees.from(staker).reward(amountToAdd),
        'only counterparty or operator',
      )
    })

    it('should revert when msg.sender is deactivated operator', async () => {
      await assert.revertWith(
        this.DeactivatedGriefing.from(operator).reward(amountToAdd),
        'only counterparty or operator',
      )
    })

    it('should succeed when msg.sender is counterparty', async () => {
      await reward(counterparty)
    })

    it('should succeed when msg.sender is operator', async () => {
      await reward(operator)
    })
  })

//TODO: fix these tests for parity + add fee and 3rd party stakeholders
//  describe('SimpleGriefing.punish', () => {
//    const from = counterparty
//    const message = "I don't like you"
//    const punishArgs = [from, punishment, Buffer.from(message)]
//    currentStake = ethers.utils.bigNumberify('0')
//
//    const punishStaker = async () => {
//      // increase staker's stake to 500
//      await NMR.from(staker).approve(
//        this.TestSimpleGriefing.contractAddress,
//        stakerStake,
//      )
//      await this.TestSimpleGriefing.from(staker).increaseStake(stakerStake)
//      currentStake = currentStake.add(stakerStake)
//
//      const expectedCost = punishment.mul(ratio)
//
//      await NMR.from(counterparty).approve(
//        this.TestSimpleGriefing.contractAddress,
//        expectedCost,
//      )
//
//      const txn = await this.TestSimpleGriefing.from(counterparty).punish(
//        punishment,
//        Buffer.from(message),
//      )
//      const receipt = await this.TestSimpleGriefing.verboseWaitForTransaction(
//        txn,
//      )
//
//      // deducting current stake to be used in subsequent increaseStake call
//      currentStake = currentStake.sub(punishment)
//
//      const expectedEvent = 'Griefed'
//
//      const griefedEvent = receipt.events.find(
//        emittedEvent => emittedEvent.event === expectedEvent,
//        'There is no such event',
//      )
//
//      assert.isDefined(griefedEvent)
//      assert.equal(griefedEvent.args.punisher, counterparty)
//      assert.equal(griefedEvent.args.staker, staker)
//      assert.equal(
//        griefedEvent.args.punishment.toString(),
//        punishment.toString(),
//      )
//      assert.equal(griefedEvent.args.cost.toString(), expectedCost.toString())
//      assert.equal(
//        griefedEvent.args.message,
//        ethers.utils.hexlify(ethers.utils.toUtf8Bytes(message)),
//      )
//    }
//
//    it('should revert when msg.sender is not counterparty or active operator', async () => {
//      // update currentStake
//      currentStake = await this.TestSimpleGriefing.getStake()
//
//      // staker is not counterparty or operator
//      await assert.revertWith(
//        this.TestSimpleGriefing.from(staker).punish(
//          punishment,
//          Buffer.from(message),
//        ),
//        'only counterparty or operator',
//      )
//    })
//
//    it('should revert when no approval to burn tokens', async () => {
//      await assert.revertWith(
//        this.TestSimpleGriefing.from(counterparty).punish(
//          punishment,
//          Buffer.from(message),
//        ),
//        'nmr burnFrom failed',
//      )
//    })
//
//    it('should punish staker', async () => await punishStaker())
//  })
//
//  describe('SimpleGriefing.releaseStake', () => {
//    let currentStake
//    const releaseAmount = ethers.utils.parseEther('100')
//
//    const releaseStake = async (sender, staker, releaseAmount) => {
//      const currentStake = await this.TestSimpleGriefing.getStake()
//
//      const txn = await this.TestSimpleGriefing.from(sender).releaseStake(
//        releaseAmount,
//      )
//      const receipt = await this.TestSimpleGriefing.verboseWaitForTransaction(
//        txn,
//      )
//      const [DepositDecreasedEvent] = utils.parseLogs(
//        receipt,
//        this.TestSimpleGriefing,
//        'DepositDecreased',
//      )
//
//      assert.equal(DepositDecreasedEvent.tokenID, tokenID)
//      assert.equal(DepositDecreasedEvent.user, staker)
//      assert.equal(
//        DepositDecreasedEvent.amount.toString(),
//        releaseAmount.toString(),
//      )
//    }
//
//    it('should revert when msg.sender is not counterparty or active operator', async () => {
//      currentStake = await this.TestSimpleGriefing.getStake()
//
//      await assert.revertWith(
//        this.TestSimpleGriefing.from(staker).releaseStake(releaseAmount),
//        'only counterparty or operator',
//      )
//    })
//
//    it('should revert when msg.sender is operator but not active', async () => {
//      await assert.revertWith(
//        this.DeactivatedGriefing.from(operator).releaseStake(releaseAmount),
//        'only counterparty or operator',
//      )
//    })
//
//    it('should release stake when msg.sender is counterparty', async () =>
//      await releaseStake(counterparty, staker, releaseAmount))
//
//    it('should release full stake', async () => {
//      const currentStake = await this.TestSimpleGriefing.getStake()
//      await releaseStake(counterparty, staker, currentStake)
//    })
//
//    it('should release stake when msg.sender is active operator', async () => {
//      // have to re-increase stake to release
//      await NMR.from(staker).approve(
//        this.TestSimpleGriefing.contractAddress,
//        stakerStake,
//      )
//
//      const currentStake = await this.TestSimpleGriefing.getStake()
//
//      await this.TestSimpleGriefing.from(staker).increaseStake(stakerStake)
//
//      await releaseStake(operator, staker, releaseAmount)
//    })
//  })
//
//  describe('SimpleGriefing.transferOperator', () => {
//    it('should revert when msg.sender is not operator', async () => {
//      await assert.revertWith(
//        this.TestSimpleGriefing.from(counterparty).transferOperator(
//          newOperator,
//        ),
//        'only operator',
//      )
//    })
//
//    it('should revert when msg.sender is not active operator', async () => {
//      await assert.revertWith(
//        this.DeactivatedGriefing.from(counterparty).transferOperator(
//          newOperator,
//        ),
//        'only operator',
//      )
//    })
//
//    it('should transfer operator', async () => {
//      const txn = await this.TestSimpleGriefing.from(operator).transferOperator(
//        newOperator,
//      )
//      await assert.emitWithArgs(txn, 'OperatorUpdated', [newOperator])
//
//      const actualOperator = await this.TestSimpleGriefing.getOperator()
//      assert.equal(actualOperator, newOperator)
//    })
//  })
//
//  describe('SimpleGriefing.renounceOperator', () => {
//    it('should revert when msg.sender is not operator', async () => {
//      await assert.revertWith(
//        this.TestSimpleGriefing.from(counterparty).renounceOperator(),
//        'only operator',
//      )
//    })
//
//    it('should revert when msg.sender is not active operator', async () => {
//      await assert.revertWith(
//        this.DeactivatedGriefing.from(operator).renounceOperator(),
//        'only operator',
//      )
//    })
//
//    it('should succeed', async () => {
//      const txn = await this.TestSimpleGriefing.from(
//        newOperator,
//      ).renounceOperator()
//      await assert.emitWithArgs(txn, 'OperatorUpdated', [
//        ethers.constants.AddressZero,
//      ])
//
//      const actualOperator = await this.TestSimpleGriefing.getOperator()
//      assert.equal(actualOperator, ethers.constants.AddressZero)
//    })
//  })
})