// Combined admitted attempts, not diagnostic steps or successful-result quotas.
export const TRAINER_EXECUTION_POLICY = {
  hardLimit: 30,
  softTarget: 20,
  finalAnswerReserve: 1,
} as const;

export function trainerExecutionBudget(
  providerAttempts: number,
  toolAttempts: number,
  hardLimit: 3 | 30 = TRAINER_EXECUTION_POLICY.hardLimit,
) {
  const consumed = providerAttempts + toolAttempts;
  const remaining = Math.max(0, hardLimit - consumed);
  return {
    ...TRAINER_EXECUTION_POLICY,
    hardLimit,
    softTarget: Math.min(TRAINER_EXECUTION_POLICY.softTarget, hardLimit),
    providerAttempts,
    toolAttempts,
    consumed,
    remaining,
    exploratoryRemaining: Math.max(
      0,
      remaining - TRAINER_EXECUTION_POLICY.finalAnswerReserve,
    ),
  };
}

export type TrainerExecutionBudget = ReturnType<typeof trainerExecutionBudget>;
