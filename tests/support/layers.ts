import { Layer, Stream } from "effect"
import { JjLayer } from "../../src/commander/jj"
import { HooksLive } from "../../src/hooks/runner"
import { AppProcess, type AppProcessService } from "../../src/process/app-process"
import {
    InteractiveProcess,
    type InteractiveProcessService,
} from "../../src/process/interactive-process"

/** Jj with live hook discovery. Production builds its own graph in `makeApplicationClient`. */
export const JjLive = JjLayer.pipe(Layer.provide(HooksLive))

export function makeAppProcessFake(
    run: AppProcessService["run"],
    stream: AppProcessService["stream"] = (command) =>
        Stream.fromEffect(run(command)).pipe(
            Stream.map((result) => ({
                _tag: "Complete" as const,
                result,
            })),
        ),
): Layer.Layer<AppProcess> {
    return Layer.succeed(AppProcess)(AppProcess.of({ run, stream }))
}

export function makeInteractiveProcessFake(
    run: InteractiveProcessService["run"],
): Layer.Layer<InteractiveProcess> {
    return Layer.succeed(InteractiveProcess, InteractiveProcess.of({ run }))
}
