/**
 * Maps database and API errors to user-friendly messages
 */
export const getUserFriendlyError = (error: any): string => {
  // Handle Supabase error objects
  const errorCode = error?.code;
  const errorMessage = error?.message?.toLowerCase() || '';

  // PostgreSQL error codes
  if (errorCode === '23505') return 'This record already exists';
  if (errorCode === '23503') return 'Related record not found';
  if (errorCode === '23502') return 'Required field is missing';
  if (errorCode === '42501') return 'You do not have permission to perform this action';
  
  // Supabase Auth errors
  if (errorMessage.includes('invalid login credentials')) {
    return 'Invalid email or password';
  }
  if (errorMessage.includes('user already registered')) {
    return 'An account with this email already exists';
  }
  if (errorMessage.includes('email not confirmed')) {
    return 'Please confirm your email address';
  }
  if (errorMessage.includes('invalid email')) {
    return 'Please enter a valid email address';
  }
  
  // Network and timeout errors
  if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
    return 'Network error. Please check your connection and try again';
  }
  if (errorMessage.includes('timeout')) {
    return 'Request timed out. Please try again';
  }

  // Generic fallback
  return 'An error occurred. Please try again';
};
