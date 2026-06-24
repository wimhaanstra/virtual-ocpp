import type { SampledValue } from './types.js';

export function normalizeSampledValue(sampledValue: SampledValue) {
  const numericValue = Number.parseFloat(sampledValue.value ?? '');
  if (!Number.isFinite(numericValue)) {
    return {
      numericValue: null,
      normalizedValue: null,
      normalizedUnit: null
    };
  }

  const measurand = sampledValue.measurand?.trim() || 'Energy.Active.Import.Register';
  const unit = sampledValue.unit?.trim().toLowerCase();

  if (measurand === 'Energy.Active.Import.Register') {
    return {
      numericValue,
      normalizedValue: unit === 'kwh' ? numericValue * 1000 : numericValue,
      normalizedUnit: 'Wh'
    };
  }

  if (measurand === 'Power.Active.Import') {
    return {
      numericValue,
      normalizedValue: unit === 'kw' ? numericValue * 1000 : numericValue,
      normalizedUnit: 'W'
    };
  }

  if (measurand === 'Current.Import') {
    return {
      numericValue,
      normalizedValue: numericValue,
      normalizedUnit: sampledValue.unit?.trim() || 'A'
    };
  }

  if (measurand === 'Voltage') {
    return {
      numericValue,
      normalizedValue: numericValue,
      normalizedUnit: sampledValue.unit?.trim() || 'V'
    };
  }

  if (measurand === 'Temperature') {
    if (unit === 'fahrenheit') {
      return {
        numericValue,
        normalizedValue: (numericValue - 32) * (5 / 9),
        normalizedUnit: 'Celsius'
      };
    }

    if (unit === 'k') {
      return {
        numericValue,
        normalizedValue: numericValue - 273.15,
        normalizedUnit: 'Celsius'
      };
    }

    return {
      numericValue,
      normalizedValue: numericValue,
      normalizedUnit: 'Celsius'
    };
  }

  return {
    numericValue,
    normalizedValue: null,
    normalizedUnit: null
  };
}
