const DEFAULT_DEBOUNCE_MS = 300;

export function debounce(fn, delay = DEFAULT_DEBOUNCE_MS) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}

