import type { ApplicationClient } from "../application/client"

export type CliApplication = Pick<
    ApplicationClient,
    "jjRepositoryRoot" | "jjRevisionSummaries" | "jjFileContent" | "jjDiff"
>
