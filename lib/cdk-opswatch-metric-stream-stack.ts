import { Stack, StackProps, CfnParameter, Fn } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as kinesis from 'aws-cdk-lib/aws-kinesisfirehose';

export class CdkOpswatchMetricStreamStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    
    const error_bucket = new s3.CfnBucket(this, 'ErrorBucket', {
      publicAccessBlockConfiguration: {
        blockPublicAcls: true,
        blockPublicPolicy: true,
        ignorePublicAcls: true,
        restrictPublicBuckets: true
      },
      accessControl: 'Private',
      bucketEncryption: {
        serverSideEncryptionConfiguration: [{
          serverSideEncryptionByDefault: {
            sseAlgorithm: 'AES256'
          }
        }]
      },
      lifecycleConfiguration: {
        rules: [{
          id: 'DeleteBackups',
          expirationInDays: 1,
          abortIncompleteMultipartUpload: {
            daysAfterInitiation: 1
          },
          status: 'Enabled'
        }]
      }
    });
    const kinesis_role = new iam.CfnRole(this, 'KinesisRole', {
      assumeRolePolicyDocument: {
        Version: '2012-10-17',
        Statement: [{
          Effect: 'Allow',
          Principal: {
            Service: 'firehose.amazonaws.com'
          },
          Action: 'sts:AssumeRole'
        }]
      },
      policies: [{
        policyName: 'HttpDelivery',
        policyDocument: {
          Version: '2012-10-17',
          Statement: [{
            Effect: 'Allow',
            Action: [
              's3:AbortMultipartUpload',
              's3:GetBucketLocation',
              's3:GetObject',
              's3:ListBucket',
              's3:ListBucketMultipartUploads',
              's3:PutObject'
            ],
            Resource: [
              error_bucket.attrArn,
              Fn.join('', [
                error_bucket.attrArn,
                '/*'
              ])
            ]
          }]
        }
      }]
    });
    const param_url = new CfnParameter(this, 'OpsWatchUrl', {
      type: 'String'
    });
    const kinesis_metric_stream = new kinesis.CfnDeliveryStream(this, 'KinesisMetricStream', {
      deliveryStreamName: 'OpswatchMetricStream',
      deliveryStreamType: 'DirectPut',
      httpEndpointDestinationConfiguration: {
        bufferingHints: {
          intervalInSeconds: 60,
          sizeInMBs: 1
        },
        roleArn: kinesis_role.attrArn,
        endpointConfiguration: {
          name: 'CentralMetricProcessor',
          url: param_url.valueAsString
        },
        retryOptions: {
          durationInSeconds: 100
        },
        s3BackupMode: 'FailedDataOnly',
        s3Configuration: {
          bucketArn: error_bucket.attrArn,
          roleArn: kinesis_role.attrArn,
          compressionFormat: 'GZIP',
          bufferingHints: {
            intervalInSeconds: 900,
            sizeInMBs: 128
          }
        }
      }
    });
    const cloudwatch_role = new iam.CfnRole(this, 'CloudwatchRole', {
      assumeRolePolicyDocument: {
        Version: '2012-10-17',
        Statement: [{
          Effect: 'Allow',
          Principal: {
            Service: 'streams.metrics.cloudwatch.amazonaws.com'
          },
          Action: 'sts:AssumeRole'
        }]
      },
      policies: [{
        policyName: 'FirehoseDelivery',
        policyDocument: {
          Version: '2012-10-17',
          Statement: [{
            Effect: 'Allow',
            Action: ['firehose:PutRecord', 'firehose:PutRecordBatch'],
            Resource: kinesis_metric_stream.attrArn
          }]
        }
      }]
    });
    // const param_filters = new CfnParameter(this, 'IncludeFilters', {
    //   type: 'CommaDelimitedList',
    //   default: '*'
    // });
    const stream = new cloudwatch.CfnMetricStream(this, 'CloudwatchMetricStream', {
      name: 'OpswatchMetricStream',
      outputFormat: 'JSON',
      roleArn: cloudwatch_role.attrArn,
      firehoseArn: kinesis_metric_stream.attrArn
    });
    // if (Fn.select(0, param_filters.valueAsList) !== '*') {
    //   stream.includeFilters = param_filters.valueAsList.map(filter => {
    //     return {
    //       namespace: filter
    //     };
    //   });
    // }
  }
}
