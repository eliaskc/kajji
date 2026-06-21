import { Schema } from "effect"

export class StackDiscoveryError extends Schema.TaggedErrorClass<StackDiscoveryError>()(
    "StackDiscoveryError",
    {
        message: Schema.String,
    },
) {}
