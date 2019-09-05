const express = require('express')
const app = express()

app.use('/floor1', express.static('63号館1F'));
app.use('/floor2', express.static('63号館2F'));
app.use('/floor3', express.static('63号館3F'));

app.listen(3000);

