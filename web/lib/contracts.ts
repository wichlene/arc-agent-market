import { Contract, type ContractRunner } from "ethers";
import deployment from "./deployment.json";
import IdentityRegistryAbi from "./abis/IdentityRegistry.json";
import ReputationRegistryAbi from "./abis/ReputationRegistry.json";
import ValidationRegistryAbi from "./abis/ValidationRegistry.json";
import JobEscrowAbi from "./abis/JobEscrow.json";

export const ADDRESSES = deployment.contracts;

export function getIdentityRegistry(runner: ContractRunner) {
  return new Contract(ADDRESSES.IdentityRegistry, IdentityRegistryAbi, runner);
}

export function getReputationRegistry(runner: ContractRunner) {
  return new Contract(ADDRESSES.ReputationRegistry, ReputationRegistryAbi, runner);
}

export function getValidationRegistry(runner: ContractRunner) {
  return new Contract(ADDRESSES.ValidationRegistry, ValidationRegistryAbi, runner);
}

export function getJobEscrow(runner: ContractRunner) {
  return new Contract(ADDRESSES.JobEscrow, JobEscrowAbi, runner);
}

export const JOB_STATUS_LABELS = ["Open", "Funded", "Submitted", "Completed", "Rejected", "Expired"] as const;
