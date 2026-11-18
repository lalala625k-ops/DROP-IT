// Independent high-saturation neon hues; no light/dark or neutral swatches.
export const BRANCH_COLOR_PALETTE = [
  { name: '荧光绯红', color: '#FF1744' },
  { name: '荧光朱橙', color: '#FF4D00' },
  { name: '荧光橙', color: '#FF7900' },
  { name: '荧光黄', color: '#FFFF00' },
  { name: '荧光柠檬', color: '#D4FF00' },
  { name: '荧光青柠', color: '#55FF00' },
  { name: '荧光绿', color: '#00FF3C' },
  { name: '荧光薄荷', color: '#00FFB3' },
  { name: '荧光青', color: '#00D9FF' },
  { name: '荧光天蓝', color: '#009DFF' },
  { name: '荧光电蓝', color: '#0055FF' },
  { name: '荧光紫', color: '#8833FF' },
  { name: '荧光兰紫', color: '#B600FF' },
  { name: '荧光品红', color: '#FF00F5' },
  { name: '荧光粉', color: '#FF00B7' },
] as const;

export const GROUP_COLOR_FAMILIES = [
  { name: 'A', color: BRANCH_COLOR_PALETTE[3].color },
  { name: 'B', color: BRANCH_COLOR_PALETTE[14].color },
  { name: 'C', color: BRANCH_COLOR_PALETTE[8].color },
  { name: 'D', color: BRANCH_COLOR_PALETTE[5].color },
] as const;

export const groupBaseColor = (name: string) =>
  GROUP_COLOR_FAMILIES.find((family) => family.name === name)?.color ?? '#FFFFFF';

export const groupColorText = (color: string) => {
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  let channels: number[];
  if (hex) {
    channels = [0, 2, 4].map((offset) => parseInt(hex[1].slice(offset, offset + 2), 16) / 255);
  } else {
    const hsl = color.match(/^hsl\((\d+)\s+(\d+)%\s+(\d+)%\)/);
    if (!hsl) return '#ffffff';
    const hue = Number(hsl[1]);
    const saturation = Number(hsl[2]) / 100;
    const lightness = Number(hsl[3]) / 100;
    const amplitude = saturation * Math.min(lightness, 1 - lightness);
    channels = [0, 8, 4].map((shift) => {
      const segment = (shift + hue / 30) % 12;
      return lightness - amplitude * Math.max(-1, Math.min(segment - 3, 9 - segment, 1));
    });
  }
  const linear = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  return luminance > 0.205 ? '#1d1d1d' : '#ffffff';
};
