import { checkDiagnosticRequest, diagnosticJson, handleDiagnostic } from './http.ts';
import { startHealthComparisonHttp, type ComparisonHttpDependencies } from './health-comparison-http.ts';
import { COMPARISON_HEADER, COMPARISON_OPERATION } from './health-comparison-request.ts';

/** Header selects a strict parser, never authorization. Each branch reads once. */
export function routeDiagnostic(request: Request, comparison: () => ComparisonHttpDependencies): Promise<Response> {
 const operation = request.headers.get(COMPARISON_HEADER);
 if (operation === null) return handleDiagnostic(request);
 if (operation !== COMPARISON_OPERATION) return Promise.resolve(checkDiagnosticRequest(request) ?? diagnosticJson({ error: 'Unsupported diagnostic operation.' }, 400));
 // Guards precede dependency construction as well as all capacity/transport work.
 const denied = checkDiagnosticRequest(request);
 if (denied) return Promise.resolve(denied);
 try { return startHealthComparisonHttp(request, { ...comparison(), requireSharedHeight: true }).response; }
 catch { return Promise.resolve(diagnosticJson({ error: 'Comparison lifecycle unavailable.' }, 503)); }
}
