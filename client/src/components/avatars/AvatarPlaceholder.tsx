export type AvatarGender = 'male' | 'female' | 'unknown';

interface AvatarPlaceholderProps {
  gender?: AvatarGender | string | null;
  className?: string;
}

// Color palettes matching Ancestry.com style
const PALETTES = {
  male: {
    bg: '#c8d5e0',      // Light blue-gray background
    skin: '#8fa4b8',    // Medium blue-gray for skin
    hair: '#3d5166',    // Dark blue-gray for hair
    clothes: '#2d3e4e'  // Darker blue for clothing
  },
  female: {
    bg: '#e8d0c8',      // Light peach/salmon background
    skin: '#c49888',    // Medium terracotta for skin
    hair: '#7a4a3a',    // Dark brown for hair
    clothes: '#6a3a2a'  // Darker brown for clothing
  },
  unknown: {
    bg: '#d0d0d0',
    skin: '#9a9a9a',
    hair: '#5a5a5a',
    clothes: '#4a4a4a'
  }
};

// Simplified human profile shapes
const MaleProfile = ({ colors }: { colors: typeof PALETTES.male }) => (
  <>
    {/* Body/Shoulders */}
    <path
      d="M 12 64 L 12 56 C 12 46 20 42 32 42 C 44 42 52 46 52 56 L 52 64 Z"
      fill={colors.clothes}
    />
    {/* Head/Neck */}
    <path
      d="M 30 42 L 30 38 
         C 24 38 22 34 22 26 
         C 22 14 28 10 34 10 
         C 42 10 46 16 46 26 
         C 46 36 40 42 36 42 
         Z"
      fill={colors.skin}
    />
    {/* Hair - Short Cap */}
    <path
      d="M 22 24 
         C 22 12 28 8 34 8 
         C 44 8 48 14 48 24 
         L 48 26 
         C 48 16 42 12 34 12 
         C 28 12 24 16 24 24 
         Z"
      fill={colors.hair}
    />
  </>
);

const FemaleProfile = ({ colors }: { colors: typeof PALETTES.female }) => (
  <>
    {/* Body/Shoulders */}
    <path
      d="M 14 64 L 14 56 C 14 46 22 42 32 42 C 42 42 50 46 50 56 L 50 64 Z"
      fill={colors.clothes}
    />
    {/* Head/Neck */}
    <path
      d="M 30 42 L 30 38 
         C 24 38 22 34 22 26 
         C 22 14 28 10 34 10 
         C 42 10 46 16 46 26 
         C 46 36 40 42 36 42 
         Z"
      fill={colors.skin}
    />
    {/* Hair - Long/Bun */}
    <path
      d="M 22 24 
         C 22 12 28 6 34 6 
         C 44 6 50 14 50 26 
         C 50 36 48 42 46 44 
         L 42 42 
         C 44 40 46 34 46 26 
         C 46 16 40 10 34 10 
         C 28 10 24 16 24 24 
         Z"
      fill={colors.hair}
    />
    {/* Bun detail */}
    <circle cx="46" cy="38" r="4" fill={colors.hair} />
  </>
);

const UnknownProfile = ({ colors }: { colors: typeof PALETTES.unknown }) => (
  <>
    {/* Shoulders/clothing */}
    <path
      d={`M 8 64 L 8 52 C 8 44 18 38 32 38 C 46 38 56 44 56 52 L 56 64 Z`}
      fill={colors.clothes}
    />
    {/* Neck */}
    <path
      d={`M 26 38 L 26 32 C 26 30 28 28 32 28 C 36 28 38 30 38 32 L 38 38 C 36 38 34 38 32 38 C 30 38 28 38 26 38 Z`}
      fill={colors.skin}
    />
    {/* Head - front facing */}
    <ellipse cx="32" cy="18" rx="12" ry="14" fill={colors.skin} />
    {/* Hair suggestion */}
    <path
      d={`M 20 14 C 20 6 26 2 32 2 C 38 2 44 6 44 14 C 44 10 38 6 32 6 C 26 6 20 10 20 14 Z`}
      fill={colors.hair}
    />
  </>
);

export function AvatarPlaceholder({ gender, className }: AvatarPlaceholderProps) {
  const safeGender: AvatarGender = gender === 'male' || gender === 'female' ? gender : 'unknown';
  const colors = PALETTES[safeGender];

  return (
    <svg
      viewBox="0 0 64 64"
      className={className || 'w-full h-full'}
      aria-hidden="true"
      preserveAspectRatio="xMidYMid slice"
    >
      <rect width="64" height="64" rx="8" fill={colors.bg} />
      {safeGender === 'male' && <MaleProfile colors={colors} />}
      {safeGender === 'female' && <FemaleProfile colors={colors} />}
      {safeGender === 'unknown' && <UnknownProfile colors={colors} />}
    </svg>
  );
}