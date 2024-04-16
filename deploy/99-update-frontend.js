const { ethers, network } = require("hardhat")
const fs = require('fs')

const FRONTEND_ADDRESS_FILE = "../nextjs-smartcontract-lottery-fcc-main/constants/contractAddresses.json"
const FRONTEND_ABI_FILE = "../nextjs-smartcontract-lottery-fcc-main/constants/abi.json"

module.exports = async function () {
    if (process.env.UPDATE_FRONTEND) {
        console.log('Updating frontend...')
        updateContractAddress()
        updateAbi()
    }
}

async function updateAbi() {
    const raffle = await ethers.getContract('Raffle')
    fs.writeFileSync(FRONTEND_ABI_FILE, raffle.interface.format(ethers.utils.FormatTypes.json))

}

async function updateContractAddress() {
    const raffle = await ethers.getContract('Raffle')
    const contractAddresses = JSON.parse(fs.readFileSync(FRONTEND_ADDRESS_FILE, "utf8"))
    const chainId = network.config.chainId.toString()
    if (chainId in contractAddresses) {
        if (!contractAddresses[chainId].includes(raffle.address)) {
            contractAddresses[chainId].push(raffle.address)
        }
    } else {
        contractAddresses[chainId] = [raffle.address]
    }

    fs.writeFileSync(FRONTEND_ADDRESS_FILE, JSON.stringify(contractAddresses))

}


module.exports.tags = ["all", "frontend"]