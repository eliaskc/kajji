import { type ParentProps, createContext, useContext } from "solid-js"
import type { ApplicationClient } from "../application/client"

const ApplicationContext = createContext<ApplicationClient>()

export function ApplicationProvider(
    props: ParentProps<{ app: ApplicationClient }>,
) {
    return (
        <ApplicationContext.Provider value={props.app}>
            {props.children}
        </ApplicationContext.Provider>
    )
}

export function useApplication(): ApplicationClient {
    const app = useContext(ApplicationContext)
    if (!app) {
        throw new Error(
            "useApplication must be used within ApplicationProvider",
        )
    }
    return app
}
