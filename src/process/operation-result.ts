export interface ProcessCompletion {
    readonly stdout: string
    readonly stderr: string
    readonly exitCode: number
    readonly success: boolean
    readonly logged?: boolean
}

export interface OperationResult extends ProcessCompletion {
    readonly command: string
}
