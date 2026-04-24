import React from 'react';

interface MonogramProps {
  letters: string;
  bg: string;
  fg?: string;
  fontSize?: number;
}

const Monogram: React.FC<MonogramProps> = ({ letters, bg, fg = '#FFFFFF', fontSize = 11 }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect width="24" height="24" rx="5" fill={bg} />
    <text
      x="50%"
      y="50%"
      dominantBaseline="central"
      textAnchor="middle"
      fill={fg}
      fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
      fontSize={fontSize}
      fontWeight="700"
      letterSpacing={letters.length > 2 ? -0.3 : 0}
    >
      {letters}
    </text>
  </svg>
);

export const DrChronoIcon: React.FC = () => <Monogram letters="DC" bg="#00A66C" />;
export const AthenaIcon: React.FC = () => <Monogram letters="a" bg="#00A1DF" fontSize={15} />;
export const ElationIcon: React.FC = () => <Monogram letters="E" bg="#E87A0C" fontSize={14} />;
export const EcwIcon: React.FC = () => <Monogram letters="eCW" bg="#2196F3" fontSize={9} />;
export const NextGenIcon: React.FC = () => <Monogram letters="N" bg="#D32F2F" fontSize={14} />;
export const TebraIcon: React.FC = () => <Monogram letters="Tb" bg="#00BFA5" />;
export const GreenwayIcon: React.FC = () => <Monogram letters="Gw" bg="#2E7D32" />;
export const PracticeFusionIcon: React.FC = () => <Monogram letters="PF" bg="#1565C0" />;
export const CernerIcon: React.FC = () => <Monogram letters="O" bg="#C74634" fontSize={14} />;
export const EpicIcon: React.FC = () => <Monogram letters="Epic" bg="#B4093C" fontSize={8} />;

export const SignalWireIcon: React.FC = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect width="24" height="24" rx="5" fill="#FF3900" />
    <path
      d="M7 13a5 5 0 0 1 10 0M9.5 13a2.5 2.5 0 0 1 5 0"
      stroke="#FFFFFF"
      strokeWidth="1.6"
      strokeLinecap="round"
      fill="none"
    />
    <circle cx="12" cy="13" r="1.1" fill="#FFFFFF" />
  </svg>
);
