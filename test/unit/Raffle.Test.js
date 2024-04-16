const { assert, expect } = require("chai")
const { network, deployments, ethers, getNamedAccounts } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")


!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Raffle Unit Tests", function () {
        let raffle, raffleContract, vrfCoordinatorV2Mock, raffleEntranceFee, interval, player, accounts
        beforeEach(async () => {
            accounts = await ethers.getSigners()
            deployer = (await getNamedAccounts()).deployer;
            player = accounts[1]
            await deployments.fixture(["mocks", "raffle"])
            vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock")
            raffleContract = await ethers.getContract("Raffle")
            raffle = raffleContract.connect(player)
            raffleEntranceFee = await raffle.getEntranceFee()
            interval = await raffle.getInterval()
        })

        describe("constructor", function () {
            it("initializes the raffle correctly", async () => {
                const raffleState = (await raffle.getRaffleState()).toString()
                assert.equal(raffleState, "0")
                assert.equal(
                    interval.toString(),
                    networkConfig[network.config.chainId]["keepersUpdateInterval"]
                )
            })
        })

        describe("enterRaffle", function () {
            it("reverts when you don't pay enough", async () => {
                await expect(raffle.enterRaffle()).to.be.revertedWith(
                    "Raffle__SendMoreToEnterRaffle"
                )
            })
            it("records player when they enter", async () => {
                await raffle.enterRaffle({ value: raffleEntranceFee })
                const contractPlayer = await raffle.getPlayer(0)
                assert.equal(await player.getAddress(), contractPlayer)
            })
            it("emits an event", async () => {
                await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.emit(
                    raffle,
                    "RaffleEnter"
                )
            })
            it("doesn't allow entrance when raffle is calculating", async () => {
                await raffle.enterRaffle({ value: raffleEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.request({ method: "evm_mine", params: [] })
                // we pretend to be a keeper for a second
                await raffle.performUpkeep([])
                await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.be.revertedWith(
                    // is reverted as raffle is calculating
                    "Raffle__RaffleNotOpen"
                )
            })
        })

        describe("checkUpKeep", async () => {
            it("reverts if people haven't semt any ETH", async () => {
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                await network.provider.send("evm_mine", []);
                const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([])
                assert(!upkeepNeeded)
            })
            it("reverts if raffle isn't open", async () => {
                await raffle.enterRaffle({ value: raffleEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.request({ method: "evm_mine", params: [] })

                await raffle.performUpkeep([])
                const raffleState = await raffle.getRaffleState()
                const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([])
                assert.equal(raffleState.toString(), "1")
                assert.equal(upkeepNeeded, false)
            })
            it("returns false if enough time has passed", async () => {
                await raffle.enterRaffle({ value: raffleEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() - 3])
                await network.provider.request({ method: "evm_mine", params: [] })
                const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x")
                assert(!upkeepNeeded)
            })
            it("returns true if enough time hase passed,enough ETH,has players and is open", async () => {
                await raffle.enterRaffle({ value: raffleEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.request({ method: "evm_mine", params: [] })
                const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x")
                assert(upkeepNeeded)
            })
        })

        describe("performUpkeep", async () => {
            it("can only run if checkUpkeep is true", async () => {
                await raffle.enterRaffle({ value: raffleEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.send("evm_mine", [])

                const tx = await raffle.performUpkeep([])
                assert(tx)
            })
            it("reverts when checkUpkeep is false", async () => {
                await expect(raffle.performUpkeep([])).to.be.revertedWith(
                    "Raffle__UpkeepNotNeeded"
                )
            })

            it("updates the raffle state emits an event", async () => {
                await raffle.enterRaffle({ value: raffleEntranceFee })
                await network.provider.request({ method: "evm_increaseTime", params: [interval.toNumber() + 1] })
                await network.provider.send("evm_mine", [])

                const txResponse = await raffle.performUpkeep([])
                const txReciept = await txResponse.wait()
                const requestId = txReciept.events[1].args.requestId
                const raffleState = await raffle.getRaffleState()
                assert(requestId.toNumber() > 0)
                assert(raffleState.toString() == "1")
            })

        })

        describe("fulfillRandomWords", async () => {
            beforeEach(async () => {
                await raffle.enterRaffle({ value: raffleEntranceFee })
                await network.provider.request({ method: "evm_increaseTime", params: [interval.toNumber() + 1] })
                await network.provider.send("evm_mine", [])
            })

            //For fulfilling randomword there should be atleast one request
            it("can only be called after performUpkeep", async () => {
                await expect(vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.address)).to.be.revertedWith(
                    "nonexistent request"
                )
            })


            it("pick a winner, resets the raffle and send money", async () => {
                const additionalEntrants = 3
                const startingAccountIndex = 1 //deplpyer = 0
                for (let i = startingAccountIndex; i < startingAccountIndex + additionalEntrants; i++) {
                    const accountConnectedRaffle = raffle.connect(accounts[i])
                    await accountConnectedRaffle.enterRaffle({ value: raffleEntranceFee })
                }
                const startingTimeStamp = await raffle.getLastTimeStamp()

                //performUpkeep
                await new Promise(async (resolve, reject) => {
                    raffle.once("WinnerPicked", async () => {
                        //Setting up the listener
                        try {
                            const raffleRecentWinner = await raffle.getRecentWinner()
                            console.log(raffleRecentWinner);
                            console.log(accounts[0].address);
                            console.log(accounts[1].address);
                            console.log(accounts[2].address);
                            console.log(accounts[3].address);
                            const winnerEndingBalance = await accounts[1].getBalance()

                            const raffleState = await raffle.getRaffleState()
                            const endingTimeStamp = await raffle.getLastTimeStamp()
                            const numPlayers = await raffle.getNumberOfPlayers()

                            assert.equal(numPlayers.toString(), "0")
                            assert.equal(raffleState.toString(), "0")
                            assert(endingTimeStamp > startingTimeStamp)

                            assert.equal(winnerEndingBalance.toString(), winnerStartingBalance.add(
                                raffleEntranceFee
                                    .mul(additionalEntrants)
                                    .add(raffleEntranceFee)
                                    .toString()
                            ))
                            resolve()
                        } catch (error) {
                            reject(error)
                        }
                    })

                    const tx = await raffle.performUpkeep([])
                    const txReciept = await tx.wait()
                    const winnerStartingBalance = await accounts[1].getBalance()
                    await vrfCoordinatorV2Mock.fulfillRandomWords(txReciept.events[1].args.requestId, raffle.address)
                })
            })
        })
    })