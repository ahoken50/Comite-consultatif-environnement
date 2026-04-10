const fs = require('fs');

let lines = fs.readFileSync('functions-python/ai_agents/speaker_profiles.py', 'utf8').split('\n');

// 1. Add imports to the top. Line index 9 (Line 10)
const insertIndex = 9;
const newImports = [
    "from audio_utils import extract_audio_segment_embedding",
    "from auto_migration import ensure_migration_completed"
];

lines.splice(insertIndex, 0, ...newImports);

// 2. Identify and remove the orphaned block
// We need to look for `        # Clean up temp files`
let startIndex = -1;
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("        # Clean up temp files") && lines[i+1].includes("        if not is_local:")) {
        startIndex = i;
        break;
    }
}

let endIndex = -1;
if (startIndex !== -1) {
    for (let i = startIndex; i < lines.length; i++) {
        // Find where the orphaned block ends, probably at `    except Exception as e:` or `        return []`
        if (lines[i].includes("        return []") && lines[i-1].includes("        print(f\"[VoiceEmbed] Error: {e}\")")) {
            endIndex = i;
            break;
        }
    }
}

if (startIndex !== -1 && endIndex !== -1) {
    // Also include surrounding blank lines
    let s = startIndex;
    while (s > 0 && lines[s-1].trim() === "") s--;
    let e = endIndex;
    while (e < lines.length - 1 && lines[e+1].trim() === "") e++;
    
    console.log(`Removing from index ${s} to ${e}`);
    lines.splice(s, e - s + 1);
    
    fs.writeFileSync('functions-python/ai_agents/speaker_profiles.py', lines.join('\n'));
    console.log("Fixed speaker_profiles.py successfully.");
} else {
    console.log("Could not find the orphaned block bounds. startIndex:", startIndex, "endIndex:", endIndex);
}
