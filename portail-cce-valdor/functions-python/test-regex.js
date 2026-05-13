const content = `
**RÉSOLUTION 16-01**

CONSIDÉRANT que l'ordre du jour de la 16e assemblée ordinaire a été transmis aux membres et qu'il a fait l'objet de légères modifications présentées en début de séance;
`;

const resRegex = /(?:\*\*|__)?R[ÉE]SOLUTION(?:\*\*|__)?(?:[\s:]*(\d{2}-\d+))?[\s:.\-*]*/gi;

const matches = [...content.matchAll(resRegex)];
console.log(matches.map(m => ({
    match: m[0],
    group1: m[1],
    index: m.index
})));
