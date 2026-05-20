import React from "react";

interface MacNestLogoProps {
  className?: string;
  size?: number;
}

export default function MacNestLogo({ className = "", size = 32 }: MacNestLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* 蜂巢网格 */}
      <g transform="translate(16, 16)">
        {/* 中心六边形 */}
        <polygon
          points="0,-7 6.1,-3.5 6.1,3.5 0,7 -6.1,3.5 -6.1,-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        {/* 上 */}
        <g transform="translate(0, -12.1)">
          <polygon
            points="0,-7 6.1,-3.5 6.1,3.5 0,7 -6.1,3.5 -6.1,-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </g>
        {/* 右上 */}
        <g transform="translate(10.5, -6.1)">
          <polygon
            points="0,-7 6.1,-3.5 6.1,3.5 0,7 -6.1,3.5 -6.1,-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </g>
        {/* 右下 */}
        <g transform="translate(10.5, 6.1)">
          <polygon
            points="0,-7 6.1,-3.5 6.1,3.5 0,7 -6.1,3.5 -6.1,-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </g>
        {/* 下 */}
        <g transform="translate(0, 12.1)">
          <polygon
            points="0,-7 6.1,-3.5 6.1,3.5 0,7 -6.1,3.5 -6.1,-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </g>
        {/* 左下 */}
        <g transform="translate(-10.5, 6.1)">
          <polygon
            points="0,-7 6.1,-3.5 6.1,3.5 0,7 -6.1,3.5 -6.1,-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </g>
        {/* 左上 */}
        <g transform="translate(-10.5, -6.1)">
          <polygon
            points="0,-7 6.1,-3.5 6.1,3.5 0,7 -6.1,3.5 -6.1,-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </g>
      </g>
    </svg>
  );
}
