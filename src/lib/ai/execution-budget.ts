// Combined admitted attempts, not diagnostic steps or successful-result quotas.
export const TRAINER_EXECUTION_POLICY = {
  hardLimit: 30,
  softTarget: 20,
  finalAnswerReserve: 1,
  analyticalSuccessLimit: 30,
} as const;

export function trainerExecutionBudget(
  providerAttempts: number,
  toolAttempts: number,
) {
  const consumed = providerAttempts + toolAttempts;
  const remaining = Math.max(0, TRAINER_EXECUTION_POLICY.hardLimit - consumed);
  return {
    ...TRAINER_EXECUTION_POLICY,
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
