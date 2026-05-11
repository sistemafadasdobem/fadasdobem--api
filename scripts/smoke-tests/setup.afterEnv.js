'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const { assertSmokeEnvironment } = require('./setup');

assertSmokeEnvironment();
