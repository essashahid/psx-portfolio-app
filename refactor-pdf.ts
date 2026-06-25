import * as fs from 'fs';

let content = fs.readFileSync('lib/company/report-pdf.ts', 'utf-8');

// The goal is to make the PDF layout continuous.
// Since it's complex, let's just make the changes manually in a few targeted chunks using multi_replace_file_content in the next step, rather than a script.
