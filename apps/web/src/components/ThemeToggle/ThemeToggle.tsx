import { useTheme } from '../../app/theme/themeContext';
import { strings } from '../../lib/strings';
import { IconButton } from '../IconButton/IconButton';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  return (
    <IconButton
      icon={isDark ? 'light_mode' : 'dark_mode'}
      label={isDark ? strings.theme.toLight : strings.theme.toDark}
      onClick={toggleTheme}
      data-testid="theme-toggle"
    />
  );
}
