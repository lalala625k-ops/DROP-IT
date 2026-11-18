// Dense mid-distance boards still have small images, but can have thousands
// of buffered DOM candidates. Use the same image-preserving raster overview
// before reaching the old fixed 18% threshold; hysteresis avoids churn.
export function shouldUseRasterOverview(previous: boolean, zoom: number, cardCount: number, imageCount: number) {
  const imageHeavy = imageCount > cardCount / 2;
  if (previous) {
    if (zoom < 0.20 && cardCount > 130) return true;
    return imageHeavy && zoom < 0.55 && cardCount > 180;
  }
  return (zoom < 0.18 && cardCount > 150) || (imageHeavy && zoom < 0.5 && cardCount > 240);
}
