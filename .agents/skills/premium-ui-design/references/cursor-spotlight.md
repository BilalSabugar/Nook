# Cursor-Responsive Ambient Spotlight & Layered Hover Physics

This reference provides the reusable React hook and CSS implementations for creating cursor-following ambient spotlights and tactile hover elevation.

## 1. Reusable React Hook: `useMouseSpotlight`

```tsx
import { useState, useCallback } from 'react';

export function useMouseSpotlight() {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setPosition({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  }, []);

  const onMouseEnter = useCallback(() => setIsHovered(true), []);
  const onMouseLeave = useCallback(() => setIsHovered(false), []);

  return {
    position,
    isHovered,
    bind: {
      onMouseMove,
      onMouseEnter,
      onMouseLeave,
    },
    style: isHovered
      ? {
          backgroundImage: `radial-gradient(350px circle at ${position.x}px ${position.y}px, rgba(255, 255, 255, 0.07), transparent 60%)`,
        }
      : undefined,
  };
}
```

## 2. CSS Micro-Interactions

```css
.interactive-card {
  transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1),
              box-shadow 0.22s cubic-bezier(0.16, 1, 0.3, 1),
              border-color 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

.interactive-card:hover {
  transform: translateY(-1.5px);
  box-shadow: 0 12px 28px -4px rgba(0, 0, 0, 0.55),
              inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.interactive-card:active {
  transform: translateY(0) scale(0.985);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}
```
