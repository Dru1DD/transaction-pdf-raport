export function toPLNDate(ts?: number) {
    if (!ts) return "-";
    try {

        return new Intl.DateTimeFormat("pl-PL", {
            timeZone: "Europe/Warsaw",
            dateStyle: "long",
            timeStyle: "medium",
        }).format(new Date(ts * 1000));
    } catch {
        return new Date(ts * 1000).toISOString();
    }
}
