/**
 * Robust test verification logic to ensure code executed in sandboxes
 * actually ran valid tests and passed without error, rather than
 * relying on loose string matching (like stdout containing 'pass' or 'ok').
 */

export interface TestVerificationResult {
  verified: boolean;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  details: string;
}

export function verifyStructuredTestOutput(
  stdout: string = '',
  stderr: string = '',
  exitCode: number = 0
): TestVerificationResult {
  if (exitCode !== 0) {
    return {
      verified: false,
      totalTests: 0,
      passedTests: 0,
      failedTests: 1,
      details: `Execution failed with non-zero exit code (${exitCode}). ${stderr.slice(0, 150)}`.trim(),
    };
  }

  const combined = `${stdout}\n${stderr}`;

  // Check for fatal errors, assertion failures, or unhandled exceptions
  if (
    /AssertionError|UnhandledPromiseRejection|ERR_ASSERTION|SyntaxError|ReferenceError|TypeError/i.test(
      combined
    )
  ) {
    return {
      verified: false,
      totalTests: 0,
      passedTests: 0,
      failedTests: 1,
      details: 'Test execution produced an assertion failure or unhandled runtime exception.',
    };
  }

  // 1. node:test / TAP summary lines
  // Examples:
  // "ℹ tests 3" / "# tests 3"
  // "ℹ pass 3" / "# pass 3"
  // "ℹ fail 0" / "# fail 0"
  const testsMatch = combined.match(/(?:ℹ|#)\s+tests\s+(\d+)/i);
  const passMatch = combined.match(/(?:ℹ|#)\s+pass\s+(\d+)/i);
  const failMatch = combined.match(/(?:ℹ|#)\s+fail\s+(\d+)/i);

  const checkmarkMatches = combined.match(/✔\s+[^\r\n]+/g) || [];
  const crossMatches = combined.match(/✖\s+[^\r\n]+/g) || [];

  const tapOkMatches = combined.match(/^ok\s+\d+\s+-\s+[^\r\n]+/gm) || [];
  const tapNotOkMatches = combined.match(/^not\s+ok\s+\d+\s+-\s+[^\r\n]+/gm) || [];

  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;

  if (testsMatch && passMatch) {
    totalTests = parseInt(testsMatch[1], 10);
    passedTests = parseInt(passMatch[1], 10);
    failedTests = failMatch ? parseInt(failMatch[1], 10) : 0;
  } else if (checkmarkMatches.length > 0 || crossMatches.length > 0) {
    passedTests = checkmarkMatches.length;
    failedTests = crossMatches.length;
    totalTests = passedTests + failedTests;
  } else if (tapOkMatches.length > 0 || tapNotOkMatches.length > 0) {
    passedTests = tapOkMatches.length;
    failedTests = tapNotOkMatches.length;
    totalTests = passedTests + failedTests;
  }

  // Strict verification criteria:
  // - At least one real test must have executed (totalTests > 0)
  // - All executed tests must have passed (failedTests === 0 && passedTests === totalTests)
  // - No failure markers (crossMatches === 0 && tapNotOkMatches === 0)
  const hasNoFailures = failedTests === 0 && crossMatches.length === 0 && tapNotOkMatches.length === 0;
  const verified = totalTests > 0 && passedTests > 0 && hasNoFailures;

  if (!verified) {
    if (totalTests === 0) {
      return {
        verified: false,
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        details:
          'No structured test runner assertions or results were detected in execution output. Plain text or console logs are insufficient for verification.',
      };
    }
    return {
      verified: false,
      totalTests,
      passedTests,
      failedTests,
      details: `Test suite verification failed: ${failedTests} failed, ${passedTests}/${totalTests} passed.`,
    };
  }

  return {
    verified: true,
    totalTests,
    passedTests,
    failedTests: 0,
    details: `Automated test suite verified: ${passedTests}/${totalTests} assertions passed with exit code 0.`,
  };
}
