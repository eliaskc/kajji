import { Show } from "solid-js"
import { useTheme } from "../context/theme"
import { WaveBackground } from "./WaveBackground"

const KAJJI_ASCII = `██╗  ██╗ █████╗      ██╗     ██╗██╗
██║ ██╔╝██╔══██╗     ██║     ██║██║
█████╔╝ ███████║     ██║     ██║██║
██╔═██╗ ██╔══██║██   ██║██   ██║██║
██║  ██╗██║  ██║╚█████╔╝╚█████╔╝██║
╚═╝  ╚═╝╚═╝  ╚═╝ ╚════╝  ╚════╝ ╚═╝`

const TAGLINE = " The rudder for your jj "

export interface WaveScreenProps {
    showLogo?: boolean
}

export function WaveScreen(props: WaveScreenProps) {
    const { colors } = useTheme()
    const showLogo = () => props.showLogo ?? true

    return (
        <box flexGrow={1} width="100%" height="100%">
            <WaveBackground peakOpacity={0.6} />
            <Show when={showLogo()}>
                <box
                    position="absolute"
                    left={0}
                    top={0}
                    width="100%"
                    height="100%"
                    flexDirection="column"
                    justifyContent="center"
                    alignItems="center"
                >
                    <box flexDirection="column" alignItems="center">
                        <text
                            fg={colors().text}
                            wrapMode="none"
                            content={KAJJI_ASCII}
                        />
                        <box height={1} />
                        <text fg={colors().primary} bg={colors().background}>
                            {TAGLINE}
                        </text>
                    </box>
                </box>
            </Show>
        </box>
    )
}
