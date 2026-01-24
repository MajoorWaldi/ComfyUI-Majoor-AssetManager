import { pickRootId } from "../../../utils/ids.js";

export const buildPayloadViewURL = (payload, { buildCustomViewURL, buildViewURL }) => {
    const type = String(payload?.type || "output").toLowerCase();
    if (type === "custom") {
        return buildCustomViewURL(payload?.filename || "", payload?.subfolder || "", pickRootId(payload));
    }
    if (type === "input") {
        return buildViewURL(payload?.filename || "", payload?.subfolder || "", "input");
    }
    return buildViewURL(payload?.filename || "", payload?.subfolder || "", "output");
};

export const getDraggedAsset = (event, mimeType) => {
    const data = event?.dataTransfer?.getData?.(mimeType);
    if (!data) return null;
    try {
        return JSON.parse(data);
    } catch {
        return null;
    }
};

