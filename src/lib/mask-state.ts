export function hasUnsavedMask(pointCount: number, saved: boolean): boolean {
    return pointCount > 0 && !saved;
}
