// useThemeMode.ts
export type ThemeMode = "dark" | "light"
const FORKMIND_THEME = "forkmind.theme"

export function loadTheme(): ThemeMode {
    try {
        const themeValue = window.localStorage.getItem(FORKMIND_THEME)
        return themeValue === "dark" || themeValue === "light"
            ? themeValue
            : "dark"
    } catch {
        return "dark"
    }
}

export function saveTheme(currentTheme: ThemeMode): void {
    try {
        window.localStorage.setItem(FORKMIND_THEME, currentTheme)
    } catch (error) {
        console.log(error)
    }
}
