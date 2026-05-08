const serverless = require('serverless-http');

let handler;
try {
    const app = require('../server');
    handler = serverless(app);
} catch (e) {
    console.error('CRITICAL: Failed to initialize app:', e);
}

module.exports.handler = async (event, context) => {
    if (!handler) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'App initialization failed on serverless' })
        };
    }
    
    try {
        return await handler(event, context);
    } catch (e) {
        console.error('RUNTIME ERROR:', e);
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                error: 'Serverless Runtime Error', 
                message: e.message,
                dbPath: process.env.DB_FILE || 'Not set',
                cwd: process.cwd(),
                files: fs.readdirSync(process.cwd()) // List files in CWD for debugging
            })
        };
    }
};

