/**
 * TypeScript Utility Proof of Concept for Majoor Assets Manager
 */

export interface FormattedDateOptions {
    locale?: string;
    style?: 'short' | 'medium' | 'long' | 'full';
}

export const formatDateTS = (timestamp: number, options: FormattedDateOptions = {}): string => {
    if (!timestamp) return 'N/A';
    
    // Handle python timestamp (seconds) vs js (ms) heuristic
    const ts = timestamp < 10000000000 ? timestamp * 1000 : timestamp;
    
    const locale = options.locale || 'en-US';
    return new Date(ts).toLocaleDateString(locale, {
        dateStyle: options.style || 'medium'
    });
};

export const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};
