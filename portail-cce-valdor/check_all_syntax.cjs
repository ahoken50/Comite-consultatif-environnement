const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const pythonPath = 'functions-python\\\\venv\\\\Scripts\\\\python.exe';
const functionsDir = 'functions-python';

function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    for (const file of list) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            if (file === 'venv' || file === '__pycache__') continue;
            results = results.concat(walk(fullPath));
        } else if (fullPath.endsWith('.py')) {
            results.push(fullPath);
        }
    }
    return results;
}

const pyFiles = walk(functionsDir);
console.log(`Found ${pyFiles.length} python files.`);

let errors = [];

for (const file of pyFiles) {
    try {
        execSync(`"${pythonPath}" -m py_compile "${file}"`, { stdio: 'pipe' });
    } catch (error) {
        errors.push({ file, output: error.stderr.toString() || error.stdout.toString() || error.message });
    }
}

if (errors.length === 0) {
    console.log("No syntax errors found!");
} else {
    for (const err of errors) {
        console.log(`\n--- ERROR IN ${err.file} ---`);
        console.log(err.output);
    }
}
