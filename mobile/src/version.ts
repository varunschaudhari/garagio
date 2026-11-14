import * as Application from 'expo-application';
import Constants from 'expo-constants';

export function appVersion(): string {
  return Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '0.0.0';
}
