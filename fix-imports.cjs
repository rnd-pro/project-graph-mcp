const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');

function getAllFiles(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) {
            results = results.concat(getAllFiles(file));
        } else if (file.endsWith('.js')) {
            results.push(file);
        }
    });
    return results;
}

const allSrcFiles = getAllFiles(srcDir);
const fileMap = {}; // filename (e.g., parser.js) -> absolute path

allSrcFiles.forEach(file => {
    fileMap[path.basename(file)] = file;
});

allSrcFiles.forEach(file => {
    let content = fs.readFileSync(file, 'utf-8');
    let changed = false;

    // Match static and dynamic imports: from "./file.js", import "./file.js", import("./file.js")
    const regex = /(from|import)(\s*\(?\s*)(['"])\.\/([^'"]+\.js)\3/g;
    
    content = content.replace(regex, (match, p1, p2, quote, filename) => {
        if (fileMap[filename]) {
            const targetPath = fileMap[filename];
            let relPath = path.relative(path.dirname(file), targetPath);
            if (!relPath.startsWith('.')) {
                relPath = './' + relPath;
            }
            changed = true;
            return `${p1}${p2}${quote}${relPath}${quote}`;
        }
        return match;
    });

    if (changed) {
        fs.writeFileSync(file, content, 'utf-8');
        console.log(`Updated ${path.relative(__dirname, file)}`);
    }
});

// Update tests/compact.test.js
const testFile = path.join(__dirname, 'tests/compact.test.js');
if (fs.existsSync(testFile)) {
    let testContent = fs.readFileSync(testFile, 'utf-8');
    let testChanged = false;
    const testRegex = /(from|import)(\s*\(?\s*)(['"])\.\.\/src\/([^'"]+\.js)\3/g;
    
    testContent = testContent.replace(testRegex, (match, p1, p2, quote, filename) => {
        if (fileMap[filename]) {
            const targetPath = fileMap[filename];
            let relPath = path.relative(path.dirname(testFile), targetPath);
            if (!relPath.startsWith('.')) {
                relPath = './' + relPath;
            }
            testChanged = true;
            return `${p1}${p2}${quote}${relPath}${quote}`;
        }
        return match;
    });

    if (testChanged) {
        fs.writeFileSync(testFile, testContent, 'utf-8');
        console.log(`Updated tests/compact.test.js`);
    }
}
