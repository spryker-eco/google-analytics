<?php

/**
 * Copyright © 2016-present Spryker Systems GmbH. All rights reserved.
 * Use of this software requires acceptance of the Evaluation License Agreement. See LICENSE file.
 */

namespace SprykerEco\Shared\GoogleAnalytics\Exception;

use Exception;

class GoogleAnalyticsInvalidConfigException extends Exception
{
    public function __construct(string $configKey)
    {
        parent::__construct(sprintf('Google Analytics configuration %s is invalid', $configKey));
    }
}
