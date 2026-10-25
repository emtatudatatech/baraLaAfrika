import { Icon } from '../Icon/Icon';
import type { IconName } from '../Icon/iconNames';
import styles from './SegmentedControl.module.css';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
}

export interface SegmentedControlProps<T extends string> {
  /** Names the group for assistive technology. */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Prefix for each button's data-testid (`${testId}-${value}`). */
  testId?: string;
}

/** A row of toggle buttons, one pressed: switches between views of the same content. */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  testId,
}: SegmentedControlProps<T>) {
  return (
    <div role="group" aria-label={label} className={styles.segmented}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          data-testid={testId === undefined ? undefined : `${testId}-${option.value}`}
          onClick={() => {
            onChange(option.value);
          }}
        >
          {option.icon !== undefined && (
            <Icon name={option.icon} size={20} className={styles.icon} />
          )}
          {option.label}
        </button>
      ))}
    </div>
  );
}
