const fs = require('fs');
let lines = fs.readFileSync('functions-python/ai_agents/claude_service.py', 'utf8').split('\n');

// We want to delete the lines 6 to 14 (array indices 6 to 14, which correspond to lines 7 to 15).
// Print what we are deleting to be sure:
console.log("Deleting the following lines containing the orphaned block:");
for (let i = 6; i < 15; i++) {
    console.log(i + ": " + lines[i]);
}

// Remove those 9 lines
lines.splice(6, 9);

fs.writeFileSync('functions-python/ai_agents/claude_service.py', lines.join('\n'));
console.log("Deleted orphans in claude_service.py by array index.");
