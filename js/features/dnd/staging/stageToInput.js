import { pickRootId } from "../../../utils/ids.js";

const _postStageToInput = async ({ post, endpoint, payload, index = true, purpose = null }) => {
    const request = {
        index: Boolean(index),
        files: [
            {
                filename: payload.filename,
                subfolder: payload.subfolder || "",
                dest_subfolder: "",
                type: payload.type || "output",
                root_id: pickRootId(payload) || undefined
            }
        ]
    };

    // Add purpose if specified (for fast path detection)
    if (purpose) {
        request.purpose = purpose;
    }

    return post(endpoint, request);
};

export const stageToInputDetailed = async ({ post, endpoint, payload, index = true, purpose = null }) => {
    const result = await _postStageToInput({ post, endpoint, payload, index, purpose });

    if (!result?.ok) {
        console.warn("Majoor: stage-to-input failed", result?.error || result);
        return null;
    }

    const staged = Array.isArray(result.data?.staged) ? result.data.staged[0] : null;
    if (!staged) return null;
    const relativePath = staged?.subfolder ? `${staged.subfolder}/${staged.name}` : staged?.name;
    return {
        relativePath: relativePath || null,
        absPath: staged?.path || null,
        name: staged?.name || null,
        subfolder: staged?.subfolder || ""
    };
};

export const stageToInput = async ({ post, endpoint, payload, index = true, purpose = null }) => {
    const detailed = await stageToInputDetailed({ post, endpoint, payload, index, purpose });
    return detailed?.relativePath || null;
};
